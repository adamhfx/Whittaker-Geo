import { Fragment, useId } from "react";
import type { LiveChart, LiveSummaryItem } from "@/lib/types";
import { formatOutputValue } from "@/lib/live-calculation";
import "./output-presentation.css";

type OutputPresentationProps = {
  summary?: LiveSummaryItem[];
  charts?: LiveChart[];
};

const SERIES_COLORS = [
  "#002d43",
  "#596238",
  "#49778b",
  "#b28b4c",
  "#758b63",
  "#8e6262",
];

/** Compact dashboard summary and chart view built from values already allowlisted by the worker. */
export function OutputPresentation({ summary = [], charts = [] }: OutputPresentationProps) {
  if (summary.length === 0 && charts.length === 0) return null;

  const sections = groupSummary(summary);

  return (
    <section className="output-presentation" aria-label="Executive dashboard results">
      {sections.map((section) => (
        <section className="output-presentation__summary" key={section.name}>
          {sections.length > 1 && <h4>{section.name}</h4>}
          <div className="output-presentation__metrics">
            {section.items.map((sourceItem) => {
              const item = correctRatioDisplay(sourceItem);
              const unit = displayUnit(item);
              return (
                <article className="output-presentation__metric" key={`${item.label}-${sourceItem.section ?? ""}`}>
                  <h5>{item.label}</h5>
                  <p className="output-presentation__metric-value">
                    {formatOutputValue(item.value, item.format)}
                  </p>
                  {unit && <p className="output-presentation__unit">{unit}</p>}
                </article>
              );
            })}
          </div>
        </section>
      ))}

      {charts.length > 0 && (
        <div className="output-presentation__charts">
          {charts.map((chart, index) => (
            <ChartCard chart={chart} key={`${chart.title}-${index}`} />
          ))}
        </div>
      )}
    </section>
  );
}

function groupSummary(summary: LiveSummaryItem[]) {
  const sections: { name: string; items: LiveSummaryItem[] }[] = [];
  for (const item of summary) {
    const name = item.section?.trim() || "Summary";
    let section = sections.find((candidate) => candidate.name === name);
    if (!section) {
      section = { name, items: [] };
      sections.push(section);
    }
    section.items.push(item);
  }
  return sections;
}

function correctRatioDisplay(item: LiveSummaryItem): LiveSummaryItem {
  // The source workbook labels this value as a ratio but applies a dollar format.
  // This display-only correction preserves the numeric value and workbook calculation.
  if (item.label === "IRR: Ratio") {
    return { ...item, label: "IRR (ratio)", format: "0.000", unit: item.unit || "Ratio" };
  }
  return item;
}

function displayUnit(item: LiveSummaryItem): string | undefined {
  if (!item.unit) return undefined;
  if (/\(display format\)/i.test(item.unit) && /%/.test(item.format ?? "")) return undefined;
  return item.unit;
}

function ChartCard({ chart }: { chart: LiveChart }) {
  const headingId = useId();
  const allValues = chart.series.flatMap((series) =>
    series.values.filter((value): value is number => value !== null),
  );
  const unit = chartAxisUnit(chart);
  const formattedUnit = unit ? ` · ${unit}` : "";

  return (
    <article className="output-presentation__chart" aria-labelledby={headingId}>
      <header className="output-presentation__chart-header">
        <h4 id={headingId}>{chart.title}</h4>
        <p>{chart.categories.length} points{formattedUnit}</p>
      </header>
      {allValues.length > 0 ? (
        <ChartSvg chart={chart} values={allValues} unit={unit} />
      ) : (
        <p className="output-presentation__no-data">No chart values are available.</p>
      )}
      <ul className="output-presentation__legend" aria-label={`${chart.title} series`}>
        {chart.series.map((series, index) => (
          <li key={`${series.name}-${index}`}>
            <span
              className="output-presentation__legend-swatch"
              style={{ backgroundColor: SERIES_COLORS[index % SERIES_COLORS.length] }}
              aria-hidden="true"
            />
            {series.name}
          </li>
        ))}
      </ul>
      <details className="output-presentation__data">
        <summary>View chart data</summary>
        <div className="output-presentation__data-scroll">
          <table>
            <caption>{chart.title} data</caption>
            <thead>
              <tr>
                <th scope="col">Point</th>
                {chart.series.map((series, index) => (
                  <th scope="col" key={`${series.name}-${index}`}>{series.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {chart.categories.map((category, categoryIndex) => (
                <tr key={`${String(category)}-${categoryIndex}`}>
                  <th scope="row">{formatCategory(category, categoryIndex)}</th>
                  {chart.series.map((series, seriesIndex) => (
                    <td key={`${series.name}-${seriesIndex}`}>
                      {formatChartValue(series.values[categoryIndex], unit)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </article>
  );
}

function ChartSvg({ chart, values, unit }: { chart: LiveChart; values: number[]; unit?: string }) {
  const width = 720;
  const height = 270;
  const left = 74;
  const right = 18;
  const top = 15;
  const bottom = 41;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  let min = Math.min(0, ...values);
  let max = Math.max(0, ...values);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const pad = (max - min) * 0.06;
  min -= pad;
  max += pad;
  const y = (value: number) => top + ((max - value) / (max - min)) * plotHeight;
  const x = (index: number) =>
    left + (chart.categories.length <= 1 ? plotWidth / 2 : (index / (chart.categories.length - 1)) * plotWidth);
  const baseline = y(0);
  const tickFormat = unit?.includes("USD") ? "#,##0.0" : "#,##0.##";
  const ticks = Array.from({ length: 5 }, (_, index) => min + ((max - min) * index) / 4);
  const band = plotWidth / Math.max(chart.categories.length, 1);
  const groupWidth = Math.min(band * 0.72, 31);
  const barWidth = Math.max(1, groupWidth / chart.series.length);
  const labelStep = Math.max(1, Math.ceil(chart.categories.length / 6));

  return (
    <div className="output-presentation__chart-scroll" role="img" aria-label={`${chart.title}; ${chart.series.length} series over ${chart.categories.length} points${unit ? `, units ${unit}` : ""}`}>
      <svg className="output-presentation__svg" viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
        {ticks.map((tick, index) => {
          const position = y(tick);
          return (
            <Fragment key={`tick-${index}`}>
              <line x1={left} x2={width - right} y1={position} y2={position} className="output-presentation__gridline" />
              <text x={left - 9} y={position + 4} className="output-presentation__tick" textAnchor="end">
                {formatOutputValue(tick, tickFormat)}
              </text>
            </Fragment>
          );
        })}
        <line x1={left} x2={width - right} y1={baseline} y2={baseline} className="output-presentation__axis" />
        {chart.kind === "line"
          ? chart.series.map((series, seriesIndex) => {
              const segments = lineSegments(series.values, x, y);
              return (
                <g key={`${series.name}-${seriesIndex}`}>
                  {segments.map((points, segmentIndex) => (
                    <polyline
                      key={segmentIndex}
                      points={points.map((point) => `${point.x},${point.y}`).join(" ")}
                      className="output-presentation__line"
                      style={{ stroke: SERIES_COLORS[seriesIndex % SERIES_COLORS.length] }}
                    />
                  ))}
                  {series.values.map((point, pointIndex) =>
                    point === null ? null : (
                      <circle
                        key={pointIndex}
                        cx={x(pointIndex)}
                        cy={y(point)}
                        r="2.5"
                        className="output-presentation__point"
                        style={{ fill: SERIES_COLORS[seriesIndex % SERIES_COLORS.length] }}
                      >
                        <title>{`${series.name}, point ${pointIndex + 1}: ${formatChartValue(point, unit)}`}</title>
                      </circle>
                    ),
                  )}
                </g>
              );
            })
          : chart.categories.map((category, categoryIndex) => (
              <g key={`${String(category)}-${categoryIndex}`}>
                {chart.series.map((series, seriesIndex) => {
                  const value = series.values[categoryIndex];
                  if (value === null) return null;
                  const barX = left + categoryIndex * band + (band - groupWidth) / 2 + seriesIndex * barWidth;
                  const valueY = y(value);
                  return (
                    <rect
                      key={`${series.name}-${seriesIndex}`}
                      x={barX}
                      y={Math.min(valueY, baseline)}
                      width={Math.max(1, barWidth - 1)}
                      height={Math.max(1, Math.abs(valueY - baseline))}
                      rx="1.5"
                      className="output-presentation__bar"
                      style={{ fill: SERIES_COLORS[seriesIndex % SERIES_COLORS.length] }}
                    >
                      <title>{`${series.name}, point ${categoryIndex + 1}: ${formatChartValue(value, unit)}`}</title>
                    </rect>
                  );
                })}
              </g>
            ))}
        {chart.categories.map((category, index) => {
          const show = index === 0 || index === chart.categories.length - 1 || index % labelStep === 0;
          if (!show) return null;
          const position = chart.kind === "column"
            ? left + index * band + band / 2
            : x(index);
          return (
            <text key={`category-${index}`} x={position} y={height - 17} className="output-presentation__tick" textAnchor="middle">
              {shortCategory(category, index)}
            </text>
          );
        })}
        <text x={(left + width - right) / 2} y={height - 2} className="output-presentation__axis-label" textAnchor="middle">Point</text>
        {unit && <text transform={`translate(14 ${(top + plotHeight / 2)}) rotate(-90)`} className="output-presentation__axis-label" textAnchor="middle">{unit}</text>}
      </svg>
    </div>
  );
}

function lineSegments(values: (number | null)[], x: (index: number) => number, y: (value: number) => number) {
  const segments: { x: number; y: number }[][] = [];
  let active: { x: number; y: number }[] = [];
  values.forEach((value, index) => {
    if (value === null) {
      if (active.length) segments.push(active);
      active = [];
      return;
    }
    active.push({ x: x(index), y: y(value) });
  });
  if (active.length) segments.push(active);
  return segments;
}

function chartAxisUnit(chart: LiveChart): string | undefined {
  for (const candidate of [chart.title, ...chart.series.map((series) => series.name)]) {
    const match = /\(([^()]+)\)/.exec(candidate);
    if (match?.[1]) return match[1].trim();
  }
  return undefined;
}

function formatChartValue(value: number | null, unit?: string): string {
  if (value === null) return "—";
  return formatOutputValue(value, unit?.includes("USD") ? "#,##0.0" : "#,##0.##");
}

function formatCategory(category: number | string, index: number): string {
  return typeof category === "string" ? category : `Point ${category || index + 1}`;
}

function shortCategory(category: number | string, index: number): string {
  return typeof category === "string" ? category : String(category || index + 1);
}
