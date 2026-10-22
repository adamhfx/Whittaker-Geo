"use client";

import { useId, useMemo, useState } from "react";
import { LoaderCircle, RotateCw } from "lucide-react";
import type { InputValues, Manifest } from "@/lib/types";
import {
  formatOutputValue,
  type LiveCalculationResult,
  type OutputSheet,
  type OutputView,
} from "@/lib/live-calculation";
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
};

export function LiveCalculation({
  manifest,
  inputs,
  enabled,
  blockedReason,
  help,
}: LiveCalculationProps) {
  const live = useLiveCalculation({ manifest, inputs, enabled });
  const result = live.status === "success" ? live.result : null;
  const titleId = useId();

  return (
    <section className="card live-calculation" aria-labelledby={titleId}>
      <header className="live-calculation__header">
        <div>
          <div className="eyebrow">Live calculation</div>
          <h2 id={titleId}>Results update as you edit</h2>
        </div>
      </header>

      <LiveStatus
        live={live}
        blockedReason={blockedReason}
        result={result}
        onRetry={live.retry}
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
  result: Pick<LiveCalculationResult, "outputSheets">;
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
    views.find((view) => view.id === selectedViewId) ?? views[0];
  const activeSheet = activeView
    ? (result.outputSheets.find((sheet) => sheet.name === activeView.sheet) ??
      null)
    : null;
  const helpText = activeView ? help?.outputViews?.[activeView.id] : undefined;

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
      <OutputTable sheet={activeSheet} label={activeView.name} />
    </div>
  );
}

function LiveStatus({
  live,
  blockedReason,
  result,
  onRetry,
}: {
  live: ReturnType<typeof useLiveCalculation>;
  blockedReason?: string;
  result: LiveCalculationResult | null;
  onRetry: () => void;
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
      <p className="live-calculation__message" role="status" aria-live="polite">
        <LoaderCircle
          className="live-calculation__spinner"
          aria-hidden="true"
        />
        Updating live results…
      </p>
    );
  }

  return (
    <div className="live-calculation__message is-error" role="alert">
      <span>
        We couldn’t update live results. {live.error || "Please try again."}
      </span>
      <button
        type="button"
        className="live-calculation__retry"
        onClick={onRetry}
      >
        <RotateCw aria-hidden="true" />
        Retry
      </button>
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
  const columnTemplate = `repeat(${Math.max(columns.length, 1)}, minmax(9rem, 15rem))`;

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
                {row.map((cell) => (
                  <div
                    key={cell.column}
                    className="live-calculation__cell"
                    role="cell"
                    style={{ gridColumn: position.get(cell.column) ?? 1 }}
                  >
                    {formatOutputValue(cell.value, cell.format)}
                  </div>
                ))}
              </div>
            ),
          )}
        </div>
      </div>
    </div>
  );
}
