import test from "node:test";
import assert from "node:assert/strict";
import { publicManifest } from "../lib/public-manifest";
import { EngineEvaluationError, engineEndpoint, evaluateDraft, evaluateSavedDraft, parseLiveResult } from "../lib/evaluation";
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
    assert.equal(init?.redirect, "manual");
    assert.equal(init?.cache, "no-store");
    assert.deepEqual(JSON.parse(String(init?.body)), { calculatorId: "test", version: manifest.version, inputs: { A1: 4 }, requesterId: "owner" });
    assert.equal((init?.headers as Record<string,string>)["X-GeoFlow-Engine-Secret"], "fixture-only");
    return new Response(JSON.stringify(result), { status: 200 });
  }) as typeof fetch;
  assert.equal((await evaluateDraft({ manifest, inputs: { A1: 4 }, requesterId: "owner", signal: new AbortController().signal, endpoint: "https://engine.example/evaluate", secret: "fixture-only", fetcher })).outputSheets.length, 1);
  assert.equal(requestCount, 1);
});

function evaluateWith(fetcher: typeof fetch, signal = new AbortController().signal) {
  return evaluateDraft({ manifest, inputs: { A1: 4 }, requesterId: "owner", signal,
    endpoint: "https://engine.example/evaluate", secret: "fixture-only", fetcher });
}

test("engine failures expose only an allowlisted diagnostic code", async () => {
  const expected = new Map([[401, "http_401"], [404, "http_404"], [422, "http_422"], [500, "http_other"]] as const);
  for (const [status, code] of expected) {
    const fetcher = (async () => new Response("private formula and secret response", { status })) as typeof fetch;
    await assert.rejects(evaluateWith(fetcher), (error: unknown) => {
      assert.ok(error instanceof EngineEvaluationError);
      assert.equal(error.code, code);
      assert.equal(error.message, "ENGINE_FAILED");
      assert.equal(error.message.includes("private formula"), false);
      return true;
    });
  }

  for (const status of [429, 503]) {
    const fetcher = (async () => new Response("provider detail must stay private", { status })) as typeof fetch;
    await assert.rejects(evaluateWith(fetcher), (error: unknown) => {
      assert.equal((error as Error).message, "ENGINE_BUSY");
      assert.equal((error as Error).message.includes("provider detail"), false);
      return true;
    });
  }
});

test("3xx engine responses are rejected without following or exposing redirect details", async () => {
  for (const status of [302, 307]) {
    let requestCount = 0;
    const fetcher = (async (_url: string | URL | Request, init?: RequestInit) => {
      requestCount++;
      assert.equal(init?.redirect, "manual");
      return new Response("private redirect body", {
        status,
        headers: { Location: "https://private-redirect.example/path?secret=value" },
      });
    }) as typeof fetch;
    await assert.rejects(evaluateWith(fetcher), (error: unknown) => {
      assert.ok(error instanceof EngineEvaluationError);
      assert.equal(error.code, "http_redirect");
      assert.equal(error.message, "ENGINE_FAILED");
      assert.equal(error.message.includes("private-redirect"), false);
      assert.equal(error.message.includes("secret=value"), false);
      return true;
    });
    assert.equal(requestCount, 1);
  }
});

test("transport and response parsing failures do not expose engine or provider details", async () => {
  const networkFailure = (async () => { throw new Error("https://private-host token=secret"); }) as typeof fetch;
  await assert.rejects(evaluateWith(networkFailure), (error: unknown) => {
    assert.ok(error instanceof EngineEvaluationError);
    assert.equal(error.code, "connection_failed");
    assert.equal(error.message, "ENGINE_FAILED");
    assert.equal(error.message.includes("private-host"), false);
    return true;
  });

  const invalidJson = (async () => new Response("formula=secret", { status: 200 })) as typeof fetch;
  await assert.rejects(evaluateWith(invalidJson), (error: unknown) => {
    assert.ok(error instanceof EngineEvaluationError);
    assert.equal(error.code, "invalid_json");
    assert.equal(error.message, "ENGINE_FAILED");
    return true;
  });

  const invalidResult = (async () => new Response(JSON.stringify({ ...result, calculatorVersion: "wrong" }), { status: 200 })) as typeof fetch;
  await assert.rejects(evaluateWith(invalidResult), (error: unknown) => {
    assert.ok(error instanceof EngineEvaluationError);
    assert.equal(error.code, "invalid_result");
    assert.equal(error.message, "ENGINE_FAILED");
    return true;
  });
});

test("engine request aborts preserve the original abort reason", async () => {
  const controller = new AbortController();
  const abortReason = new DOMException("route deadline elapsed", "AbortError");
  controller.abort(abortReason);
  const fetcher = (async () => { throw abortReason; }) as typeof fetch;
  await assert.rejects(evaluateWith(fetcher, controller.signal), (error: unknown) => error === abortReason);
});

test("saved export transport validates version and bounded XLSX bytes", async () => {
  const bytes = Buffer.from([80, 75, 3, 4, 1, 2, 3]);
  const options = { manifest, inputs: { A1: 4 }, requesterId: "server-user",
    endpoint: engineEndpoint("https://engine.test", false, "export"), secret: "server-only",
    signal: new AbortController().signal };
  assert.equal(options.endpoint, "https://engine.test/export");
  const reply = (payload: unknown) => async () => new Response(JSON.stringify(payload));
  const valid = await evaluateSavedDraft({ ...options, fetcher: reply({ result, xlsxBase64: bytes.toString("base64") }) });
  assert.deepEqual(Array.from(valid.workbook), Array.from(bytes));
  assert.equal(JSON.stringify(valid.result).includes("SECRET"), false);
  for (const payload of [
    { result, xlsxBase64: Buffer.from("not a workbook").toString("base64") },
    { result: { ...result, calculatorVersion: "wrong" }, xlsxBase64: bytes.toString("base64") },
    { result, xlsxBase64: "A".repeat(1_333_340) },
    { result, xlsxBase64: "!!!!" },
  ]) await assert.rejects(evaluateSavedDraft({ ...options, fetcher: reply(payload) }), /ENGINE_FAILED/);
});


test("undefined workbook results are distinguished without exposing engine details", async () => {
  for (const [body, expected] of [
    [JSON.stringify({ error: "RESULT_INVALID" }), "model_result_invalid"],
    [JSON.stringify({ error: "CALCULATION_FAILED" }), "http_422"],
    [JSON.stringify({ error: "RESULT_INVALID", detail: "private".repeat(100) }), "http_422"],
    ["private provider formula", "http_422"],
  ]) {
    const fetcher = (async () => new Response(body, { status: 422 })) as typeof fetch;
    await assert.rejects(evaluateWith(fetcher), (error: unknown) => {
      assert.ok(error instanceof EngineEvaluationError);
      assert.equal(error.code, expected);
      assert.equal(error.message, "ENGINE_FAILED");
      return true;
    });
  }
});
