"use client";
import {useEffect,useRef,useState} from "react";
import {formatOutputValue,type OutputSheet} from "@/lib/live-calculation";
export function RawOutputTable({ sheet, label }: { sheet: OutputSheet; label: string }) {
  const tableScroll = useRef<HTMLDivElement>(null);
  const topScroll = useRef<HTMLDivElement>(null);
  const table = useRef<HTMLDivElement>(null);
  const [scrollWidth, setScrollWidth] = useState(0);
  useEffect(() => {
    const container = tableScroll.current;
    const content = table.current;
    if (!container || !content) return;
    const measure = () => {
      setScrollWidth(content.scrollWidth > container.clientWidth + 1 ? content.scrollWidth : 0);
      if (topScroll.current) topScroll.current.scrollLeft = container.scrollLeft;
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    observer.observe(content);
    return () => observer.disconnect();
  }, [sheet, label]);
  const synchronize = (from: HTMLDivElement, to: HTMLDivElement | null) => {
    if (to && Math.abs(to.scrollLeft - from.scrollLeft) > 1) to.scrollLeft = from.scrollLeft;
  };
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
    <div className="live-calculation__table-frame">
    <div className="live-calculation__top-scroll" ref={topScroll} hidden={!scrollWidth}
      role="region" aria-label={`Top horizontal scrollbar for ${label}`} tabIndex={0}
      onScroll={(event) => synchronize(event.currentTarget, tableScroll.current)}>
      <div style={{ width: scrollWidth, height: 1 }} />
    </div>
    <div
      ref={tableScroll}
      onScroll={(event) => synchronize(event.currentTarget, topScroll.current)}
      className="live-calculation__table-scroll"
      role="region"
      aria-label={`Scrollable ${label} output values`}
      tabIndex={0}
    >
      <div
        ref={table}
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
    </div>
  );
}
