import test from "node:test";
import assert from "node:assert/strict";
import { publicManifest } from "../lib/public-manifest";
import { engineEndpoint, evaluateDraft, parseLiveResult } from "../lib/evaluation";
import { validateInputs } from "../lib/validation";
import type { Manifest } from "../lib/types";

const manifest = {
  id: "test", version: "2.0.0-candidate.1", name: "Test", description: "Fixture",
  inputSheet: "PRIVATE", runtimeSha256: "private-checksum", releaseStatus: "review_required",
  groups: [{ id: "reservoir", name: "Reservoir", help: { title: "Reservoir", body: "User-facing guide." }, privateFormula: "SECRET" }],
  fields: [{ id: "A1", cell: "A1", label: "Volume", unit: "m³", group: "reservoir", type: "number", default: 3, required: true, blankOnNew: true, help: { title: "Volume", body: "User-facing field note.", formula: "SECRET" }, privateFormula: "SECRET" }],
  outputs: { views: [{ id: "cash", label: "Cash flow", sheet: "Cash OUTPUT", sourceRange: "A1:C2", privateFormula: "SECRET" }] },
  multipliers: [], privateFormula: "SECRET",
} as unknown as Manifest;
const result = { calculatorId: manifest.id, calculatorVersion: manifest.version, durationSeconds: 1,
  outputSheets: [{ name: "Cash OUTPUT", rows: [{ cells: [{ column: 1, value: "Revenue", format: "0.0", formula: "SECRET" }, { column: 2, value: 23 }] }], sourcePath: "SECRET" }], rawWorkbook: "SECRET" };

test("public model metadata retains requested guide content without private workbook material", () => {
  const safe = publicManifest(manifest);
  assert.equal(safe.groups[0].help?.body, "User-facing guide.");
  assert.equal(safe.fields[0].help?.body, "User-facing field note.");
  assert.deepEqual(safe.outputViews, [{ id: "cash", name: "Cash flow", sheet: "Cash OUTPUT" }]);
  for (const privateValue of ["SECRET", "private-checksum", "sourceRange", "inputSheet", '"cell"'])
    assert.equal(JSON.stringify(safe).includes(privateValue), false);
});

test("models without a facilities milestone do not inherit the old model's milestone requirement", () => {
  assert.deepEqual(validateInputs({ A1: 4 }, manifest, true), []);
});

test("live output must match the exact model version and output allowlist", () => {
  const parsed = parseLiveResult(result, manifest);
  assert.equal(JSON.stringify(parsed).includes("SECRET"), false);
  assert.throws(() => parseLiveResult({ ...result, calculatorVersion: "old" }, manifest));
  assert.throws(() => parseLiveResult({ ...result, outputSheets: [{ name: "Hidden formulas", rows: [] }] }, manifest));
  assert.throws(() => parseLiveResult({ ...result, outputSheets: [result.outputSheets[0], result.outputSheets[0]] }, manifest));
  assert.throws(() => parseLiveResult({ ...result, outputSheets: [{ name: "Cash OUTPUT", rows: [{ cells: [{ column: 1, value: Infinity }] }] }] }, manifest));
});

test("engine URL requires HTTPS except explicit local development", () => {
  assert.equal(engineEndpoint("https://engine.example"), "https://engine.example/evaluate");
  assert.equal(engineEndpoint("http://127.0.0.1:8765", true), "http://127.0.0.1:8765/evaluate");
  for (const url of [undefined, "http://engine.example", "https://secret@engine.example", "https://engine.example?key=x"])
    assert.throws(() => engineEndpoint(url));
});

test("live evaluation forwards only draft inputs and server-side identity, without saving a run", async () => {
  let requestCount = 0;
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    requestCount++;
    assert.equal(String(url), "https://engine.example/evaluate");
    assert.equal(init?.redirect, "error");
    assert.equal(init?.cache, "no-store");
    assert.deepEqual(JSON.parse(String(init?.body)), { calculatorId: "test", version: manifest.version, inputs: { A1: 4 }, requesterId: "owner" });
    assert.equal((init?.headers as Record<string,string>)["X-GeoFlow-Engine-Secret"], "fixture-only");
    return new Response(JSON.stringify(result), { status: 200 });
  }) as typeof fetch;
  assert.equal((await evaluateDraft({ manifest, inputs: { A1: 4 }, requesterId: "owner", signal: new AbortController().signal, endpoint: "https://engine.example/evaluate", secret: "fixture-only", fetcher })).outputSheets.length, 1);
  assert.equal(requestCount, 1);
});
