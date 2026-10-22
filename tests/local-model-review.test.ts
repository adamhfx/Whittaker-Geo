import assert from "node:assert/strict";
import test from "node:test";
import {
  canUseLocalModelReview,
  isLoopbackEngineUrl,
  isLoopbackHostname,
} from "../lib/local-model-review";

const base = {
  nodeEnv: "development",
  enabled: "true",
  requestUrl: "http://127.0.0.1:3000/api/local-model-review",
  host: "127.0.0.1:3000",
  origin: "http://127.0.0.1:3000",
};

test("local model review requires development, opt-in, and same-origin loopback", () => {
  assert.equal(canUseLocalModelReview(base), true);
  assert.equal(
    canUseLocalModelReview({
      ...base,
      requestUrl: "http://localhost:3000/api/local-model-review",
      host: "localhost:3000",
      origin: "http://localhost:3000",
    }),
    true,
  );
  assert.equal(
    canUseLocalModelReview({
      ...base,
      requestUrl: "http://[::1]:3000/api/local-model-review",
      host: "[::1]:3000",
      origin: "http://[::1]:3000",
    }),
    true,
  );
});

test("production can never enable the local review endpoint", () => {
  assert.equal(
    canUseLocalModelReview({ ...base, nodeEnv: "production" }),
    false,
  );
});

test("local model review rejects missing opt-in and non-loopback or mismatched origins", () => {
  assert.equal(canUseLocalModelReview({ ...base, enabled: "false" }), false);
  assert.equal(canUseLocalModelReview({ ...base, origin: null }), false);
  assert.equal(
    canUseLocalModelReview({
      ...base,
      requestUrl: "http://example.com:3000/api/local-model-review",
    }),
    false,
  );
  assert.equal(
    canUseLocalModelReview({
      ...base,
      requestUrl: "http://localhost:3000/api/local-model-review",
      host: "127.0.0.1:3000",
      origin: "http://127.0.0.1:3000",
    }),
    true,
  );
  assert.equal(
    canUseLocalModelReview({ ...base, host: "evil.example:3000" }),
    false,
  );
  assert.equal(
    canUseLocalModelReview({ ...base, host: "127.0.0.1:3001" }),
    false,
  );
  assert.equal(
    canUseLocalModelReview({ ...base, origin: "http://example.com:3000" }),
    false,
  );
  assert.equal(
    canUseLocalModelReview({ ...base, origin: "http://127.0.0.1:3001" }),
    false,
  );
  assert.equal(
    canUseLocalModelReview({
      ...base,
      origin: "http://127.0.0.1:3000/unexpected-path",
    }),
    false,
  );
});

test("only loopback hosts can be configured for the private calculation engine", () => {
  assert.equal(isLoopbackEngineUrl("http://127.0.0.1:8765"), true);
  assert.equal(isLoopbackEngineUrl("http://localhost:8765"), true);
  assert.equal(isLoopbackEngineUrl("http://[::1]:8765"), true);
  assert.equal(isLoopbackEngineUrl("https://engine.example.com"), false);
  assert.equal(isLoopbackEngineUrl(undefined), false);
  assert.equal(isLoopbackHostname("[::1]"), true);
});
