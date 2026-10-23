import type {
  Annual,
  InputValues,
  LiveChart,
  LiveSummaryItem,
  Result,
} from "./types";

export type OutputCellValue = string | number | null;
export type OutputCell = {
  column: number;
  value: OutputCellValue;
  format?: string;
};
export type OutputRow = { cells: OutputCell[] };
export type OutputSheet = { name: string; rows: OutputRow[] };
export type OutputView = { id: string; name: string; sheet: string };

export type LiveCalculationResult = {
  calculatorId: string;
  calculatorVersion: string;
  outputSheets: OutputSheet[];
  durationSeconds: number;
  metrics?: Result["metrics"];
  annual?: Annual[];
  summary?: LiveSummaryItem[];
  charts?: LiveChart[];
};

export const LIVE_BUSY_RETRY_DELAYS_MS = [500, 1_000, 2_000, 4_000, 8_000] as const;
const MAX_RETRY_AFTER_MS = 30_000;
type RetryWait = (delayMs: number, signal: AbortSignal) => Promise<void>;

export function liveEvaluationKey(
  calculatorId: string,
  version: string,
  inputs: InputValues,
  endpoint?: string,
): string {
  const inputKey = JSON.stringify(
    Object.keys(inputs)
      .sort()
      .map((id) => [id, inputs[id]]),
  );
  const requestEndpoint =
    endpoint ?? `/api/calculators/${encodeURIComponent(calculatorId)}/evaluate`;
  return JSON.stringify([calculatorId, version, requestEndpoint, inputKey]);
}

export type EvaluationLease = {
  signal: AbortSignal;
  isCurrent: () => boolean;
};

/** Aborts old network work and gives each request a token that can reject late responses. */
export class LatestEvaluationGate {
  private generation = 0;
  private controller: AbortController | null = null;

  begin(): EvaluationLease {
    this.controller?.abort();
    const controller = new AbortController();
    const generation = ++this.generation;
    this.controller = controller;

    return {
      signal: controller.signal,
      isCurrent: () =>
        generation === this.generation &&
        this.controller === controller &&
        !controller.signal.aborted,
    };
  }

  invalidate() {
    this.generation += 1;
    this.controller?.abort();
    this.controller = null;
  }
}

export function scheduleDebouncedEvaluation(
  callback: () => void,
  delayMs = 450,
): () => void {
  const timer = setTimeout(callback, delayMs);
  return () => clearTimeout(timer);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function waitForRetryDelay(
  delayMs: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted)
    return Promise.reject(signal.reason ?? new Error("Evaluation aborted."));

  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      reject(signal.reason ?? new Error("Evaluation aborted."));
    };

    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}

function retryAfterMilliseconds(response: Response): number | null {
  const value = response.headers.get("Retry-After")?.trim();
  if (!value) return null;

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;

  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

function isRetryableBusyResponse(
  response: Response,
  message: string,
  hasRetryAfter: boolean,
): boolean {
  if (response.status === 429) return true;
  if (response.status !== 503) return false;
  return (
    hasRetryAfter ||
    /\b(?:engine_busy|busy|rate.?limit(?:ed)?|temporarily unavailable)\b/i.test(
      message,
    )
  );
}

function isMetrics(value: unknown): value is Result["metrics"] {
  return (
    isRecord(value) &&
    isFiniteNumber(value.contractorNpv10) &&
    isFiniteNumber(value.stateNpv10) &&
    isFiniteNumber(value.contractorCashFlow) &&
    isFiniteNumber(value.capitalInvestment) &&
    (value.irr === null || isFiniteNumber(value.irr)) &&
    (value.payoutYear === null || isFiniteNumber(value.payoutYear))
  );
}

function isAnnual(value: unknown): value is Annual {
  return (
    isRecord(value) &&
    isFiniteNumber(value.year) &&
    isFiniteNumber(value.contractor) &&
    isFiniteNumber(value.contractorCumulative) &&
    isFiniteNumber(value.state) &&
    isFiniteNumber(value.stateCumulative) &&
    isFiniteNumber(value.capex) &&
    isFiniteNumber(value.opex) &&
    isFiniteNumber(value.gas) &&
    isFiniteNumber(value.oil)
  );
}

function isOutputCell(value: unknown): value is OutputCell {
  return (
    isRecord(value) &&
    Number.isInteger(value.column) &&
    (value.column as number) >= 1 &&
    (value.column as number) <= 16_384 &&
    (value.value === null ||
      typeof value.value === "string" ||
      isFiniteNumber(value.value)) &&
    (value.format === undefined || typeof value.format === "string")
  );
}

function isOutputSheet(value: unknown): value is OutputSheet {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    value.name.length > 0 &&
    Array.isArray(value.rows) &&
    value.rows.every((row) => {
      if (!isRecord(row) || !Array.isArray(row.cells)) return false;
      const columns = new Set<number>();
      for (const cell of row.cells) {
        if (!isOutputCell(cell) || columns.has(cell.column)) return false;
        columns.add(cell.column);
      }
      return true;
    })
  );
}

function isPresentationSummary(value: unknown): value is LiveSummaryItem {
  return (
    isRecord(value) &&
    (value.section === undefined ||
      (typeof value.section === "string" && value.section.length <= 100)) &&
    typeof value.label === "string" &&
    value.label.length > 0 &&
    value.label.length <= 120 &&
    (value.value === null ||
      (typeof value.value === "string" && value.value.length <= 500) ||
      isFiniteNumber(value.value)) &&
    (value.format === undefined ||
      (typeof value.format === "string" && value.format.length <= 200)) &&
    (value.unit === undefined ||
      (typeof value.unit === "string" && value.unit.length <= 100))
  );
}

function isPresentationChart(value: unknown): value is LiveChart {
  if (
    !isRecord(value) ||
    typeof value.title !== "string" ||
    value.title.length === 0 ||
    value.title.length > 120 ||
    (value.kind !== "line" && value.kind !== "column") ||
    !Array.isArray(value.categories) ||
    value.categories.length < 1 ||
    value.categories.length > 100 ||
    !Array.isArray(value.series) ||
    value.series.length < 1 ||
    value.series.length > 10
  ) return false;

  const categories = value.categories;
  return (
    categories.every(
      (category) =>
        (typeof category === "string" && category.length <= 100) ||
        isFiniteNumber(category),
    ) &&
    value.series.every(
      (series) =>
        isRecord(series) &&
        typeof series.name === "string" &&
        series.name.length > 0 &&
        series.name.length <= 100 &&
        Array.isArray(series.values) &&
        series.values.length === categories.length &&
        series.values.length <= 100 &&
        series.values.every(
          (point) => point === null || isFiniteNumber(point),
        ),
    )
  );
}

export function isLiveCalculationResult(
  value: unknown,
): value is LiveCalculationResult {
  return (
    isRecord(value) &&
    typeof value.calculatorId === "string" &&
    typeof value.calculatorVersion === "string" &&
    Array.isArray(value.outputSheets) &&
    value.outputSheets.every(isOutputSheet) &&
    isFiniteNumber(value.durationSeconds) &&
    value.durationSeconds >= 0 &&
    (value.metrics === undefined || isMetrics(value.metrics)) &&
    (value.annual === undefined ||
      (Array.isArray(value.annual) && value.annual.every(isAnnual))) &&
    (value.summary === undefined ||
      (Array.isArray(value.summary) &&
        value.summary.length <= 30 &&
        value.summary.every(isPresentationSummary))) &&
    (value.charts === undefined ||
      (Array.isArray(value.charts) &&
        value.charts.length <= 8 &&
        value.charts.every(isPresentationChart)))
  );
}

function sanitizeLiveResult(value: LiveCalculationResult): LiveCalculationResult {
  const result: LiveCalculationResult = {
    calculatorId: value.calculatorId,
    calculatorVersion: value.calculatorVersion,
    durationSeconds: value.durationSeconds,
    outputSheets: value.outputSheets.map((sheet) => ({
      name: sheet.name,
      rows: sheet.rows.map((row) => ({
        cells: row.cells.map((cell) => ({
          column: cell.column,
          value: cell.value,
          ...(cell.format === undefined ? {} : { format: cell.format }),
        })),
      })),
    })),
  };
  if (value.metrics !== undefined) result.metrics = value.metrics;
  if (value.annual !== undefined) result.annual = value.annual;
  if (value.summary !== undefined) {
    result.summary = value.summary.map((item) => ({
      ...(item.section === undefined ? {} : { section: item.section }),
      label: item.label,
      value: item.value,
      ...(item.format === undefined ? {} : { format: item.format }),
      ...(item.unit === undefined ? {} : { unit: item.unit }),
    }));
  }
  if (value.charts !== undefined) {
    result.charts = value.charts.map((chart) => ({
      title: chart.title,
      kind: chart.kind,
      categories: [...chart.categories],
      series: chart.series.map((series) => ({
        name: series.name,
        values: [...series.values],
      })),
    }));
  }
  return result;
}

export class LiveCalculationRequestError extends Error {
  constructor(message: string, readonly status: number, readonly reason?: "IRR_UNDEFINED") {
    super(message);
    this.name = "LiveCalculationRequestError";
  }
}

export async function requestLiveCalculation(
  calculatorId: string,
  version: string,
  inputs: InputValues,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
  waitForRetry: RetryWait = waitForRetryDelay,
  endpoint?: string,
): Promise<LiveCalculationResult> {
  let retryIndex = 0;

  while (true) {
    const response = await fetcher(
      endpoint ??
        `/api/calculators/${encodeURIComponent(calculatorId)}/evaluate`,
      {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version, inputs }),
        signal,
      },
    );

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok) {
      const message =
        isRecord(payload) && typeof payload.error === "string"
          ? payload.error
          : `The calculation request failed (${response.status}).`;
      const retryAfterMs = retryAfterMilliseconds(response);
      const canRetry =
        retryIndex < LIVE_BUSY_RETRY_DELAYS_MS.length &&
        isRetryableBusyResponse(response, message, retryAfterMs !== null) &&
        (retryAfterMs === null || retryAfterMs <= MAX_RETRY_AFTER_MS);

      if (canRetry) {
        const backoff = LIVE_BUSY_RETRY_DELAYS_MS[retryIndex];
        await waitForRetry(Math.max(backoff, retryAfterMs ?? 0), signal);
        retryIndex += 1;
        continue;
      }
      throw new LiveCalculationRequestError(message, response.status,
        response.status === 422 && isRecord(payload) && payload.reason === "IRR_UNDEFINED" ? "IRR_UNDEFINED" : undefined);
    }

    const resultPayload =
      isRecord(payload) && "result" in payload ? payload.result : payload;
    if (!isLiveCalculationResult(resultPayload))
      throw new Error(
        "The calculation returned results in an unexpected format.",
      );
    if (
      resultPayload.calculatorId !== calculatorId ||
      resultPayload.calculatorVersion !== version
    )
      throw new Error(
        "The results came from a different calculator version. Try again.",
      );

    return sanitizeLiveResult(resultPayload);
  }
}

function numberFormatOptions(format: string) {
  const sections = format.split(";");
  const positive = sections[0] || "General";
  const numberPattern = positive
    .replace(/\[[^\]]+\]/g, "")
    .replace(/"[^"]*"/g, "");
  const decimals = numberPattern.match(/\.([0#?]+)/)?.[1];
  const isGeneral = !format || /^General$|^@$/i.test(positive.trim());
  return {
    positive,
    negative: sections[1] || "",
    zero: sections[2] || "",
    numberPattern,
    decimals,
    isGeneral,
  };
}

/** Formats common workbook number formats while rendering all strings as plain text. */
export function formatOutputValue(value: OutputCellValue, format = ""): string {
  if (value === null) return "";
  if (typeof value === "string") return value;
  if (!Number.isFinite(value)) return "";

  const sections = numberFormatOptions(format);
  if (value === 0 && sections.zero) {
    const zeroLiteral = sections.zero
      .replace(/\[[^\]]+\]/g, "")
      .replace(/"/g, "")
      .trim();
    if (/^[-–—]$/.test(zeroLiteral)) return zeroLiteral;
  }

  const pattern =
    value < 0 && sections.negative ? sections.negative : sections.positive;
  const cleanPattern = pattern
    .replace(/\[[^\]]+\]/g, "")
    .replace(/"[^"]*"/g, "");
  const decimals = cleanPattern.match(/\.([0#?]+)/)?.[1];
  if (/[Ee][+-]?[0#?]+/.test(cleanPattern))
    return value.toExponential(decimals?.length ?? 2).replace("e", "E");

  const percent = cleanPattern.includes("%");
  const currencyCode =
    /\[\$([A-Z]{3})(?:-[^\]]*)?\]/i.exec(pattern)?.[1]?.toUpperCase() ??
    /\b(USD|CAD|EUR|GBP)\b/i.exec(pattern)?.[1]?.toUpperCase();
  const currencySymbol = /[$€£¥]/.exec(pattern)?.[0];
  const absoluteValue = Math.abs(value) * (percent ? 100 : 1);
  const isGeneral = sections.isGeneral;
  const minFractionDigits = decimals?.match(/0/g)?.length ?? 0;
  const maxFractionDigits = isGeneral ? 8 : (decimals?.length ?? 0);
  let formatted = new Intl.NumberFormat("en-CA", {
    useGrouping: cleanPattern.includes(","),
    minimumFractionDigits: minFractionDigits,
    maximumFractionDigits: Math.max(minFractionDigits, maxFractionDigits),
  }).format(absoluteValue);

  if (currencyCode) formatted = `${currencyCode} ${formatted}`;
  else if (currencySymbol) formatted = `${currencySymbol}${formatted}`;
  if (percent) formatted += "%";
  if (value < 0) {
    if (pattern.includes("(") && pattern.includes(")")) return `(${formatted})`;
    return `-${formatted}`;
  }
  return formatted;
}
