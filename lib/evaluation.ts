import { z } from "zod";
import type { InputValues, LiveResult, Manifest } from "./types";

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

export function engineEndpoint(configured: string | undefined, development = false) {
  if (!configured) throw new Error("ENGINE_NOT_CONFIGURED");
  const url = new URL(configured);
  if (url.username || url.password || url.search || url.hash ||
    (url.protocol !== "https:" && !(development && url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))))
    throw new Error("ENGINE_NOT_CONFIGURED");
  url.pathname = url.pathname.replace(/\/$/, "") + "/evaluate";
  return url.toString();
}

export async function evaluateDraft(options: {
  manifest: Manifest; inputs: InputValues; requesterId: string; signal: AbortSignal;
  endpoint: string; secret: string; fetcher?: typeof fetch;
}): Promise<LiveResult> {
  const response = await (options.fetcher ?? fetch)(options.endpoint, {
    method: "POST", cache: "no-store", redirect: "error", signal: options.signal,
    headers: { "Content-Type": "application/json", "X-GeoFlow-Engine-Secret": options.secret },
    body: JSON.stringify({ calculatorId: options.manifest.id, version: options.manifest.version,
      inputs: options.inputs, requesterId: options.requesterId }),
  });
  if (!response.ok) {
    if (response.status === 429 || response.status === 503) throw new Error("ENGINE_BUSY");
    throw new Error("ENGINE_FAILED");
  }
  const result = await response.text();
  if (result.length > 2_000_000) throw new Error("ENGINE_FAILED");
  return parseLiveResult(JSON.parse(result), options.manifest);
}
