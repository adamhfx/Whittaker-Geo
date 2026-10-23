import assert from "node:assert/strict";
import test from "node:test";
import {
  formatOutputValue,
  liveEvaluationKey,
  LIVE_BUSY_RETRY_DELAYS_MS,
  LatestEvaluationGate,
  LiveCalculationRequestError,
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
  assert.notEqual(
    liveEvaluationKey("state-rent", "1.0.0", inputs, "/api/local-model-review"),
    original,
  );
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

test("live evaluation can target the opt-in local review endpoint", async () => {
  let requestedUrl = "";
  const fetcher: typeof fetch = async (input) => {
    requestedUrl = String(input);
    return new Response(JSON.stringify({ result: resultFixture() }), {
      status: 200,
    });
  };

  await requestLiveCalculation(
    "state-rent",
    "1.0.0",
    {},
    new AbortController().signal,
    fetcher,
    undefined,
    "/api/local-model-review",
  );

  assert.equal(requestedUrl, "/api/local-model-review");
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

test("live evaluation retries busy responses with bounded backoff and Retry-After", async () => {
  const delays: number[] = [];
  let attempts = 0;
  const fetcher: typeof fetch = async () => {
    attempts += 1;
    if (attempts === 1) {
      return new Response(JSON.stringify({ error: "Rate limited." }), {
        status: 429,
        headers: { "Retry-After": "1" },
      });
    }
    if (attempts === 2) {
      return new Response(
        JSON.stringify({ error: "The calculation service is busy." }),
        { status: 503 },
      );
    }
    if (attempts === 3) {
      return new Response(JSON.stringify({ error: "Please retry shortly." }), {
        status: 503,
        headers: { "Retry-After": "0.5" },
      });
    }
    return new Response(JSON.stringify({ result: resultFixture() }), {
      status: 200,
    });
  };

  const result = await requestLiveCalculation(
    "state-rent",
    "1.0.0",
    {},
    new AbortController().signal,
    fetcher,
    async (delayMs) => {
      delays.push(delayMs);
    },
  );

  assert.equal(result.calculatorVersion, "1.0.0");
  assert.deepEqual(delays, [
    1_000,
    LIVE_BUSY_RETRY_DELAYS_MS[1],
    LIVE_BUSY_RETRY_DELAYS_MS[2],
  ]);
  assert.equal(attempts, 4);
});

test("live evaluation survives five startup busy responses before succeeding", async () => {
  const delays: number[] = [];
  let attempts = 0;
  const fetcher: typeof fetch = async () => {
    attempts += 1;
    if (attempts <= 5) {
      return new Response(
        JSON.stringify({ error: "The calculation service is busy." }),
        { status: 503, headers: { "Retry-After": "5" } },
      );
    }
    return new Response(JSON.stringify({ result: resultFixture() }), {
      status: 200,
    });
  };

  const result = await requestLiveCalculation(
    "state-rent",
    "1.0.0",
    {},
    new AbortController().signal,
    fetcher,
    async (delayMs) => {
      delays.push(delayMs);
    },
  );

  assert.equal(result.calculatorVersion, "1.0.0");
  assert.equal(attempts, 6);
  assert.deepEqual(delays, [5_000, 5_000, 5_000, 5_000, 8_000]);
});

test("aborting during busy backoff prevents another fetch", async () => {
  const controller = new AbortController();
  let attempts = 0;
  let enterBackoff!: () => void;
  const backoffStarted = new Promise<void>((resolve) => {
    enterBackoff = resolve;
  });
  const fetcher: typeof fetch = async () => {
    attempts += 1;
    return new Response(
      JSON.stringify({ error: "The calculation service is busy." }),
      { status: 503 },
    );
  };
  const pending = requestLiveCalculation(
    "state-rent",
    "1.0.0",
    {},
    controller.signal,
    fetcher,
    (_delay, signal) =>
      new Promise<void>((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => reject(signal.reason ?? new Error("aborted")),
          { once: true },
        );
        enterBackoff();
      }),
  );

  await backoffStarted;
  controller.abort();
  await assert.rejects(pending);
  assert.equal(attempts, 1);
});

test("non-busy service errors do not retry", async () => {
  let attempts = 0;
  const fetcher: typeof fetch = async () => {
    attempts += 1;
    return new Response(
      JSON.stringify({
        error: "The live calculation service is not connected yet.",
      }),
      { status: 503 },
    );
  };

  await assert.rejects(
    requestLiveCalculation(
      "state-rent",
      "1.0.0",
      {},
      new AbortController().signal,
      fetcher,
      async () => {
        assert.fail("A non-busy error should not enter backoff.");
      },
    ),
    /not connected yet/i,
  );
  assert.equal(attempts, 1);
});

test("busy retries stop after five retries", async () => {
  let attempts = 0;
  const fetcher: typeof fetch = async () => {
    attempts += 1;
    return new Response(JSON.stringify({ error: "RATE_LIMITED" }), {
      status: 429,
    });
  };
  const delays: number[] = [];

  await assert.rejects(
    requestLiveCalculation(
      "state-rent",
      "1.0.0",
      {},
      new AbortController().signal,
      fetcher,
      async (delayMs) => {
        delays.push(delayMs);
      },
    ),
    /RATE_LIMITED/,
  );
  assert.equal(attempts, LIVE_BUSY_RETRY_DELAYS_MS.length + 1);
  assert.deepEqual(delays, LIVE_BUSY_RETRY_DELAYS_MS);
});

test("workbook formats render percentages, accounting negatives, zero dashes, and text literally", () => {
  assert.equal(formatOutputValue(0.125, "0.0%"), "12.5%");
  assert.equal(
    formatOutputValue(-1_234.5, "$#,##0.00;($#,##0.00)"),
    "($1,234.50)",
  );
  assert.equal(
    formatOutputValue(-1_234.5, "$#,##0.00;€#,##0.00"),
    "-€1,234.50",
  );
  assert.equal(formatOutputValue(0, '#,##0;(#,##0);"-"'), "-");
  assert.equal(formatOutputValue(-0.125, "0.0%;(0.0%);-"), "(12.5%)");
  assert.equal(formatOutputValue(-0.125, "0.0%;-0.0%;-"), "-12.5%");
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


test("undefined scenarios require an edit instead of retrying the same inputs", async () => {
  let attempts = 0;
  const message = "Review the values you just changed.";
  await assert.rejects(requestLiveCalculation("state-rent", "1.0.0", {},
    new AbortController().signal, async () => {
      attempts++;
      return new Response(JSON.stringify({ error: message }), { status: 422 });
    }, async () => { assert.fail("An input-dependent failure must not retry."); }),
    (error: unknown) => {
      assert.ok(error instanceof LiveCalculationRequestError);
      assert.equal(error.status, 422);
      assert.equal(error.message, message);
      return true;
    });
  assert.equal(attempts, 1);
});
