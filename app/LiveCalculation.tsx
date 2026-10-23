"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { LoaderCircle, RotateCw } from "lucide-react";
import type { InputValues, Manifest } from "@/lib/types";
import {
  formatOutputValue,
  type LiveCalculationResult,
  type OutputSheet,
  type OutputView,
} from "@/lib/live-calculation";
import { OutputPresentation } from "./OutputPresentation";
import { HelpDialog } from "./HelpDialog";
import { useLiveCalculation } from "./useLiveCalculation";
import "./live-calculation.css";

type LiveManifest = Manifest & { outputViews?: OutputView[] };
type LiveHelp = { outputViews?: Record<string, string> };

type LiveCalculationProps = {
  manifest: LiveManifest;
  inputs: InputValues;
  enabled: boolean;
  blockedReason?: string;
  help?: LiveHelp;
  endpoint?: string;
  reviewMode?: boolean;
  onReviewInput?: (id: string) => void;
  onRestoreInputs?: (inputs: InputValues) => void;
};

export function LiveCalculation({
  manifest,
  inputs,
  enabled,
  blockedReason,
  help,
  endpoint,
  reviewMode = false,
  onReviewInput,
  onRestoreInputs,
}: LiveCalculationProps) {
  const live = useLiveCalculation({ manifest, inputs, enabled, endpoint });
  const result = live.status === "success" ? live.result : null;
  const titleId = useId();
  const isUpdating = live.status === "updating";
  const [longWait, setLongWait] = useState(false);

  useEffect(() => {
    if (!isUpdating) {
      setLongWait(false);
      return;
    }

    setLongWait(false);
    const timer = window.setTimeout(() => setLongWait(true), 10_000);
    return () => window.clearTimeout(timer);
  }, [isUpdating]);

  return (
    <section
      className="card live-calculation"
      aria-labelledby={titleId}
      aria-busy={live.status === "debouncing" || isUpdating}
    >
      <header className="live-calculation__header">
        <div>
          <div className="eyebrow">
            {reviewMode ? "Local model review" : "Live calculation"}
          </div>
          <h2 id={titleId}>Results update as you edit</h2>
        </div>
      </header>

      <LiveStatus
        live={live}
        blockedReason={blockedReason}
        result={result}
        onRetry={live.retry}
        longWait={longWait}
        onReviewInput={onReviewInput}
        onRestoreInputs={onRestoreInputs}
      />

      {result && (
        <WorkbookOutputs result={result} manifest={manifest} help={help} />
      )}
    </section>
  );
}

/** Renders saved output-only results without triggering another calculation. */
export function WorkbookOutputs({
  result,
  manifest,
  help,
}: {
  result: Pick<LiveCalculationResult, "outputSheets" | "summary" | "charts">;
  manifest: LiveManifest;
  help?: LiveHelp;
}) {
  const [selectedViewId, setSelectedViewId] = useState("");
  const views = useMemo(() => {
    const available = new Set(result.outputSheets.map((sheet) => sheet.name));
    if (manifest.outputViews) {
      return manifest.outputViews.filter((view) => available.has(view.sheet));
    }
    return result.outputSheets.map((sheet) => ({
      id: sheet.name,
      name: sheet.name,
      sheet: sheet.name,
    }));
  }, [manifest.outputViews, result.outputSheets]);
  const activeView =
    views.find((view) => view.id === selectedViewId) ??
    views.find((view) => view.id === "executive-dashboard") ??
    views[0];
  const activeSheet = activeView
    ? (result.outputSheets.find((sheet) => sheet.name === activeView.sheet) ??
      null)
    : null;
  const helpText = activeView ? help?.outputViews?.[activeView.id] : undefined;
  const isExecutiveDashboard = activeView?.id === "executive-dashboard";

  if (!activeView || !activeSheet) {
    return (
      <p className="live-calculation__empty">
        This result has no displayable output tabs.
      </p>
    );
  }

  return (
    <div className="live-calculation__results">
      <div
        className="live-calculation__tabs"
        role="group"
        aria-label="Output tabs"
      >
        {views.map((view) => (
          <button
            key={view.id}
            type="button"
            className={
              "live-calculation__tab" +
              (view.id === activeView.id ? " is-active" : "")
            }
            aria-pressed={view.id === activeView.id}
            onClick={() => setSelectedViewId(view.id)}
          >
            {view.name}
          </button>
        ))}
      </div>
      <div className="live-calculation__output-heading">
        <h3>{activeView.name}</h3>
        {helpText && (
          <HelpDialog
            title={activeView.name}
            body={helpText}
            triggerLabel={`Help for ${activeView.name} outputs`}
          />
        )}
      </div>
      {isExecutiveDashboard && (result.summary?.length || result.charts?.length) ? (
        <OutputPresentation summary={result.summary} charts={result.charts} />
      ) : null}
      {isExecutiveDashboard ? (
        <details className="live-calculation__raw-output">
          <summary>Detailed output cells</summary>
          <OutputTable sheet={activeSheet} label={activeView.name} />
        </details>
      ) : (
        <OutputTable sheet={activeSheet} label={activeView.name} />
      )}
    </div>
  );
}

function LiveStatus({
  live,
  blockedReason,
  result,
  onRetry,
  longWait,
  onReviewInput,
  onRestoreInputs,
}: {
  live: ReturnType<typeof useLiveCalculation>;
  blockedReason?: string;
  result: LiveCalculationResult | null;
  onRetry: () => void;
  longWait: boolean;
  onReviewInput?: (id: string) => void;
  onRestoreInputs?: (inputs: InputValues) => void;
}) {
  if (live.status === "success") {
    return (
      <p className="live-calculation__message" role="status" aria-live="polite">
        Live results are current for these inputs.
        {result && (
          <span className="live-calculation__duration">
            Updated in {result.durationSeconds.toFixed(2)} seconds.
          </span>
        )}
      </p>
    );
  }

  if (live.status === "blocked") {
    return (
      <div className="live-calculation__message is-blocked" role="status">
        {blockedReason || "Live calculations are unavailable in this session."}
      </div>
    );
  }

  if (live.status === "invalid") {
    const visibleErrors = live.errors.slice(0, 5);
    return (
      <div
        className="live-calculation__message is-invalid"
        role="status"
        aria-live="polite"
      >
        <p>Complete the required inputs to see live results.</p>
        <ul>
          {visibleErrors.map((message, index) => (
            <li key={`${index}-${message}`}>{message}</li>
          ))}
        </ul>
        {live.errors.length > visibleErrors.length && (
          <p className="live-calculation__more-errors">
            And {live.errors.length - visibleErrors.length} more input checks
            need attention.
          </p>
        )}
      </div>
    );
  }

  if (live.status === "debouncing") {
    return (
      <p className="live-calculation__message" role="status" aria-live="polite">
        Waiting for your edits to pause before updating results…
      </p>
    );
  }

  if (live.status === "updating") {
    return (
      <div
        className="live-calculation__message is-updating"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        <LoaderCircle
          className="live-calculation__spinner"
          aria-hidden="true"
        />
        <div className="live-calculation__updating-copy">
          <strong>Calculating...</strong>
          <span>
            {longWait
              ? "The first calculation after inactivity can take one to two minutes. You can keep editing while it runs."
              : "Your inputs remain available while the results update."}
          </span>
        </div>
      </div>
    );
  }

  if (!live.canRetry) {
    const changes = live.diagnosis?.changes ?? [];
    const workingInputs = live.diagnosis?.workingInputs;
    const changeList = (items: typeof changes) => (
      <ul className="live-calculation__input-changes">
        {items.map((change) => (
          <li key={change.id}>
            <div><strong>{change.label}</strong>
              <span>{change.previous} <span aria-label="changed to">→</span> {change.current}</span>
              <small>{change.section}</small>
            </div>
            {onReviewInput && <button type="button" className="btn" onClick={() => onReviewInput(change.id)}
              aria-label={`Go to ${change.label}`}>Go to input</button>}
          </li>
        ))}
      </ul>
    );
    return (
      <div className="live-calculation__message is-invalid live-calculation__input-diagnosis" role="alert">
        <strong>{changes.length === 1
          ? `Calculation stopped after changing ${changes[0].label}.`
          : "The model couldn’t calculate this combination of inputs."}</strong>
        <p>{changes.length === 1
          ? "This is the only input that differs from the last successful calculation. Review its value or restore the working inputs."
          : changes.length > 1
            ? `${changes.length} inputs changed since the last successful calculation. One value or their combination may be responsible; a single cause has not been isolated.`
            : workingInputs
              ? "These inputs match the last successful calculation, so no specific input change can be identified. Try again or report this calculation for investigation."
              : "There is no successful calculation to compare in this session, so a specific input cannot be identified yet."}</p>
        {changes.length > 0 && <>
          {changeList(changes.slice(0, 6))}
          {changes.length > 6 && <details><summary>Show {changes.length - 6} more changed inputs</summary>{changeList(changes.slice(6))}</details>}
          {workingInputs && onRestoreInputs && <button type="button" className="btn" onClick={() => onRestoreInputs({ ...workingInputs })}>
            <RotateCw size={15} aria-hidden="true" />Restore last working inputs
          </button>}
          <p className="small">Your edits are preserved. Results update automatically when you change an input.</p>
        </>}
        {workingInputs && changes.length === 0 && <button type="button" className="btn" onClick={onRetry}>Retry calculation</button>}
      </div>
    );
  }

  return (
    <div className="live-calculation__message is-error" role="alert">
      <span>
        {live.canRetry ? "We couldn’t update live results. " : ""}{live.error || "Please try again."}
      </span>
      {live.canRetry && <button
        type="button"
        className="live-calculation__retry"
        onClick={onRetry}
      >
        <RotateCw aria-hidden="true" />
        Retry
      </button>}
    </div>
  );
}

function OutputTable({ sheet, label }: { sheet: OutputSheet; label: string }) {
  const rows = sheet.rows.map((row) =>
    row.cells
      .filter((cell) => cell.value !== null && cell.value !== "")
      .slice()
      .sort((a, b) => a.column - b.column),
  );
  const columns = Array.from(
    new Set(rows.flatMap((row) => row.map((cell) => cell.column))),
  ).sort((a, b) => a - b);
  const position = new Map(columns.map((column, index) => [column, index + 1]));
  const isYearHeading = (value: unknown) => typeof value === "string" && /^year(?:\s*\((?:project|qi)\))?$/i.test(value.trim());
  const yearColumns = new Set(rows.flatMap(row => row.filter(cell => isYearHeading(cell.value)).map(cell => cell.column)));
  const columnTemplate = columns.map(column => yearColumns.has(column) ? "5rem" : "minmax(9rem, 15rem)").join(" ");

  if (rows.every((row) => row.length === 0)) {
    return (
      <p className="live-calculation__empty">
        No output values are available in this tab.
      </p>
    );
  }

  return (
    <div
      className="live-calculation__table-scroll"
      role="region"
      aria-label={`Scrollable ${label} output values`}
      tabIndex={0}
    >
      <div
        className="live-calculation__table"
        role="table"
        aria-label={`${label} output values`}
      >
        <div role="rowgroup">
          {rows.map((row, rowIndex) =>
            row.length === 0 ? (
              <div
                key={`spacer-${rowIndex}`}
                className="live-calculation__row is-spacer"
                aria-hidden="true"
              />
            ) : (
              <div
                key={`row-${rowIndex}`}
                className="live-calculation__row"
                role="row"
                style={{ gridTemplateColumns: columnTemplate }}
              >
                {row.map((cell, cellIndex) => {
                  const isYear = yearColumns.has(cell.column);
                  const column = position.get(cell.column) ?? 1;
                  // Workbook section labels above the year heading can use the empty
                  // columns to their right instead of wrapping into an 80px strip.
                  const isSectionLabel = isYear && typeof cell.value === "string" && !isYearHeading(cell.value);
                  const end = row[cellIndex + 1] ? position.get(row[cellIndex + 1].column)! : columns.length + 1;
                  return (
                    <div
                      key={cell.column}
                      className={`live-calculation__cell${isYear && !isSectionLabel ? " live-calculation__cell--year" : ""}`}
                      role="cell"
                      style={{ gridColumn: isSectionLabel ? `${column} / ${end}` : column }}
                    >
                      {formatOutputValue(cell.value, cell.format)}
                    </div>
                  );
                })}
              </div>
            ),
          )}
        </div>
      </div>
    </div>
  );
}
