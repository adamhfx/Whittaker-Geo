import test from "node:test";
import assert from "node:assert/strict";
import {
  preparationEngine,
  PreparationEngineError,
} from "../lib/preparation-engine";

test("preparation sends only its internal identity to a fixed endpoint without following redirects", async () => {
  const payload = { uploadId: "upload", actorId: "admin", leaseToken: "lease" };
  const result = await preparationEngine("prepare", payload, {
    url: "https://engine.example",
    secret: "private",
    fetcher: (async (url, options) => {
      assert.equal(url, "https://engine.example/prepare");
      assert.equal(options?.redirect, "manual");
      assert.equal(JSON.stringify(payload), options?.body);
      assert.equal(
        (options?.headers as Record<string, string>)["X-GeoFlow-Engine-Secret"],
        "private",
      );
      return Response.json({ status: "validating" });
    }) as typeof fetch,
  });
  assert.deepEqual(result, { status: "validating" });
});

test("preparation treats provider redirects and downtime as recoverable without exposing provider data", async () => {
  for (const status of [302, 401, 404, 503])
    await assert.rejects(
      preparationEngine(
        "prepare",
        {},
        {
          url: "https://engine.example",
          secret: "private",
          fetcher: (async () =>
            new Response("private provider details", {
              status,
            })) as typeof fetch,
        },
      ),
      (error) =>
        error instanceof PreparationEngineError &&
        error.retryable &&
        !error.message.includes("provider details"),
    );
  await assert.rejects(
    preparationEngine(
      "prepare",
      {},
      {
        url: "http://untrusted.example",
        secret: "private",
        fetcher: (async () => {
          throw new Error("must not call");
        }) as typeof fetch,
      },
    ),
    PreparationEngineError,
  );
  await assert.rejects(
    preparationEngine(
      "review",
      {},
      {
        url: "https://engine.example",
        secret: "private",
        fetcher: (async () =>
          new Response("invalid", { status: 422 })) as typeof fetch,
      },
    ),
    (error) => error instanceof PreparationEngineError && !error.retryable,
  );
});
