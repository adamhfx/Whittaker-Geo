import assert from "node:assert/strict";
import test from "node:test";
import {
  formatOutputValue,
  liveEvaluationKey,
  LatestEvaluationGate,
  requestLiveCalculation,
  scheduleDebouncedEvaluation,
  type LiveCalculationResult,
} from "../lib/live-calculation";

function resultFixture(
  calculatorId = "state-rent",
  calculatorVersion = "1.0.0",
): LiveCalculationResult {
  return {
    calculatorId,
    calculatorVersion,
    durationSeconds: 0.125,
    outputSheets: [
      {
        name: "OUTPUT",
        rows: [
          {
            cells: [
              { column: 1, value: "Contractor NPV" },
              { column: 4, value: 1_250_000, format: "$#,##0" },
            ],
          },
        ],
      },
    ],
  };
}

test("a newer evaluation aborts the older request and owns the current generation", () => {
  const gate = new LatestEvaluationGate();
  const oldLease = gate.begin();
  const newLease = gate.begin();

  assert.equal(oldLease.signal.aborted, true);
  assert.equal(oldLease.isCurrent(), false);
  assert.equal(newLease.signal.aborted, false);
  assert.equal(newLease.isCurrent(), true);
});

test("live snapshot identity changes when the model or workbook version changes", () => {
  const inputs = { C5: "NG", D6: 700_000_000_000 };
  const original = liveEvaluationKey("state-rent", "1.0.0", inputs);

  assert.notEqual(liveEvaluationKey("other-model", "1.0.0", inputs), original);
  assert.notEqual(liveEvaluationKey("state-rent", "1.0.1", inputs), original);
});

test("an invalidated request cannot overwrite a newer result even if it resolves late", async () => {
  const gate = new LatestEvaluationGate();
  let resolveOld!: (value: string) => void;
  let resolveNew!: (value: string) => void;
  const oldResponse = new Promise<string>((resolve) => {
    resolveOld = resolve;
  });
  const newResponse = new Promise<string>((resolve) => {
    resolveNew = resolve;
  });
  let visibleResult = "";

  const oldLease = gate.begin();
  const oldCommit = oldResponse.then((value) => {
    if (oldLease.isCurrent()) visibleResult = value;
  });
  const newLease = gate.begin();
  const newCommit = newResponse.then((value) => {
    if (newLease.isCurrent()) visibleResult = value;
  });

  resolveNew("new inputs");
  await newCommit;
  resolveOld("old inputs");
  await oldCommit;

  assert.equal(visibleResult, "new inputs");
  assert.equal(oldLease.signal.aborted, true);
});

test("input edits can invalidate both the active request and pending commits", () => {
  const gate = new LatestEvaluationGate();
  const lease = gate.begin();

  gate.invalidate();

  assert.equal(lease.signal.aborted, true);
  assert.equal(lease.isCurrent(), false);
});

test("live evaluation posts an input snapshot to the no-store evaluate endpoint", async () => {
  let requestedUrl = "";
  let requestInit: RequestInit | undefined;
  const fetcher: typeof fetch = async (input, init) => {
    requestedUrl = String(input);
    requestInit = init;
    return new Response(JSON.stringify({ result: resultFixture() }), {
      status: 200,
    });
  };
  const controller = new AbortController();
  const inputs = { C5: "NG", D6: 700_000_000_000 };

  const result = await requestLiveCalculation(
    "state-rent",
    "1.0.0",
    inputs,
    controller.signal,
    fetcher,
  );

  assert.equal(requestedUrl, "/api/calculators/state-rent/evaluate");
  assert.equal(requestInit?.method, "POST");
  assert.equal(requestInit?.cache, "no-store");
  assert.equal(requestInit?.signal, controller.signal);
  assert.deepEqual(JSON.parse(String(requestInit?.body)), {
    version: "1.0.0",
    inputs,
  });
  assert.equal(result.outputSheets[0].name, "OUTPUT");
});

test("live evaluation rejects a response from a different workbook version", async () => {
  const fetcher: typeof fetch = async () =>
    new Response(
      JSON.stringify({ result: resultFixture("state-rent", "0.9.0") }),
      { status: 200 },
    );

  await assert.rejects(
    requestLiveCalculation(
      "state-rent",
      "1.0.0",
      {},
      new AbortController().signal,
      fetcher,
    ),
    /different calculator version/i,
  );
});

test("workbook formats render percentages, accounting negatives, zero dashes, and text literally", () => {
  assert.equal(formatOutputValue(0.125, "0.0%"), "12.5%");
  assert.equal(
    formatOutputValue(-1_234.5, "$#,##0.00;($#,##0.00)"),
    "($1,234.50)",
  );
  assert.equal(formatOutputValue(0, '#,##0;(#,##0);"-"'), "-");
  assert.equal(formatOutputValue("<b>value</b>"), "<b>value</b>");
});

test("debounce cancellation drops intermediate input evaluations", async () => {
  const calls: string[] = [];
  const cancelIntermediate = scheduleDebouncedEvaluation(
    () => calls.push("intermediate"),
    15,
  );
  cancelIntermediate();
  const cancelLatest = scheduleDebouncedEvaluation(
    () => calls.push("latest"),
    20,
  );

  await new Promise<void>((resolve) => setTimeout(resolve, 40));
  cancelLatest();

  assert.deepEqual(calls, ["latest"]);
});
