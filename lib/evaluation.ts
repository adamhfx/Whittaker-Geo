import { z } from "zod";
import type { InputValues, LiveResult, Manifest } from "./types";

export type EngineEvaluationFailureCode =
  | "connection_failed"
  | "http_401"
  | "http_404"
  | "http_422"
  | "model_result_invalid"
  | "http_redirect"
  | "http_other"
  | "invalid_json"
  | "invalid_result";

export class EngineEvaluationError extends Error {
  readonly code: EngineEvaluationFailureCode;

  constructor(code: EngineEvaluationFailureCode) {
    super("ENGINE_FAILED");
    this.name = "EngineEvaluationError";
    this.code = code;
  }
}

const summaryItemSchema = z.object({
  section: z.string().max(100).optional(),
  label: z.string().min(1).max(120),
  value: z.union([z.string().max(500), z.number().finite(), z.null()]),
  format: z.string().max(200).optional(),
  unit: z.string().max(100).optional(),
});

const chartSchema = z.object({
  title: z.string().min(1).max(120),
  kind: z.enum(["line", "column"]),
  categories: z
    .array(z.union([z.string().max(100), z.number().finite()]))
    .min(1)
    .max(100),
  series: z
    .array(
      z.object({
        name: z.string().min(1).max(100),
        values: z.array(z.union([z.number().finite(), z.null()])).max(100),
      }),
    )
    .min(1)
    .max(10),
}).superRefine((chart, context) => {
  for (const [index, series] of chart.series.entries()) {
    if (series.values.length !== chart.categories.length) {
      context.addIssue({
        code: "custom",
        path: ["series", index, "values"],
        message: "Chart series values must match the category count.",
      });
    }
  }
});

const liveResultSchema = z.object({
  calculatorId: z.string().max(100), calculatorVersion: z.string().max(100),
  durationSeconds: z.number().finite().nonnegative(),
  outputSheets: z.array(z.object({ name: z.string().max(100),
    rows: z.array(z.object({ cells: z.array(z.object({
      column: z.number().int().min(1).max(500),
      value: z.union([z.string().max(10000), z.number().finite(), z.null()]),
      format: z.string().max(200).optional(),
    })).max(500) })).max(1000),
  })).max(8),
  summary: z.array(summaryItemSchema).max(30).optional(),
  charts: z.array(chartSchema).max(8).optional(),
});

export function parseLiveResult(value: unknown, manifest: Manifest): LiveResult {
  const result = liveResultSchema.parse(value);
  const names = Array.isArray(manifest.outputs) ? manifest.outputs
    : manifest.outputs.views.map((view) => view.sheet);
  if (result.calculatorId !== manifest.id || result.calculatorVersion !== manifest.version ||
      result.outputSheets.length !== names.length || new Set(result.outputSheets.map((sheet) => sheet.name)).size !== names.length ||
      result.outputSheets.some((sheet) => !names.includes(sheet.name)))
    throw new Error("Calculation response does not match the requested model.");
  return result;
}

export function engineEndpoint(configured: string | undefined, development = false, action: "evaluate" | "export" = "evaluate") {
  if (!configured) throw new Error("ENGINE_NOT_CONFIGURED");
  const url = new URL(configured);
  if (url.username || url.password || url.search || url.hash ||
    (url.protocol !== "https:" && !(development && url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))))
    throw new Error("ENGINE_NOT_CONFIGURED");
  url.pathname = url.pathname.replace(/\/$/, "") + "/" + action;
  return url.toString();
}

type EvaluationOptions = {
  manifest: Manifest; inputs: InputValues; requesterId: string; signal: AbortSignal;
  endpoint: string; secret: string; fetcher?: typeof fetch;
};

async function enginePayload(options: EvaluationOptions, maxLength: number): Promise<unknown> {
  let response: Response;
  try {
    response = await (options.fetcher ?? fetch)(options.endpoint, {
      method: "POST", cache: "no-store", redirect: "manual", signal: options.signal,
      headers: { "Content-Type": "application/json", "X-GeoFlow-Engine-Secret": options.secret },
      body: JSON.stringify({ calculatorId: options.manifest.id, version: options.manifest.version,
        inputs: options.inputs, requesterId: options.requesterId }),
    });
  } catch (error) {
    // Keep request cancellation and the route's own timeout signal intact so
    // their existing handling can distinguish an abort from a transport fault.
    if (options.signal.aborted) throw error;
    throw new EngineEvaluationError("connection_failed");
  }
  if (!response.ok) {
    if (response.status === 429 || response.status === 503) throw new Error("ENGINE_BUSY");
    if (response.status === 422) {
      // Only this exact engine code describes an input-dependent undefined
      // result. Provider text, formulas and unknown failures remain private.
      let invalidModelResult = false;
      try {
        const text = await response.text();
        invalidModelResult = text.length <= 256 && JSON.parse(text)?.error === "RESULT_INVALID";
      } catch (error) {
        if (options.signal.aborted) throw error;
      }
      if (invalidModelResult) throw new EngineEvaluationError("model_result_invalid");
    }
    const code: EngineEvaluationFailureCode = response.status >= 300 && response.status < 400 ? "http_redirect"
      : response.status === 401 ? "http_401"
      : response.status === 404 ? "http_404"
      : response.status === 422 ? "http_422"
      : "http_other";
    throw new EngineEvaluationError(code);
  }
  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    if (options.signal.aborted) throw error;
    throw new EngineEvaluationError("connection_failed");
  }
  if (text.length > maxLength) throw new EngineEvaluationError("invalid_result");
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new EngineEvaluationError("invalid_json");
  }
  return value;
}

export async function evaluateDraft(options: EvaluationOptions): Promise<LiveResult> {
  const value = await enginePayload(options, 2_000_000);
  try { return parseLiveResult(value, options.manifest); }
  catch { throw new EngineEvaluationError("invalid_result"); }
}

export async function evaluateSavedDraft(options: EvaluationOptions): Promise<{ result: LiveResult; workbook: Uint8Array }> {
  const value = await enginePayload(options, 3_400_000);
  try {
    if (!value || typeof value !== "object") throw new Error();
    const payload = value as Record<string, unknown>;
    const encoded = payload.xlsxBase64;
    if (typeof encoded !== "string" || encoded.length > 1_333_336 ||
        (encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))) throw new Error();
    const workbook = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
    if (workbook.length < 4 || workbook.length > 1_000_000 ||
        workbook[0] !== 80 || workbook[1] !== 75 || workbook[2] !== 3 || workbook[3] !== 4) throw new Error();
    return { result: parseLiveResult(payload.result, options.manifest), workbook };
  } catch { throw new EngineEvaluationError("invalid_result"); }
}
