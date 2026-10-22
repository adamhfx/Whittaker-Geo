import assert from "node:assert/strict";
import test from "node:test";
import { canonicalPageUrl } from "../lib/canonical-page";

test("production sign-in and workspace links stay on the configured origin", () => {
  const origin = "https://whittakergeo.com";
  assert.equal(canonicalPageUrl("/signin?next=%2Fcalculators", "old.workers.dev", origin, true), "https://whittakergeo.com/signin?next=%2Fcalculators");
  assert.equal(canonicalPageUrl("/calculations/new?calculator=state-rent&section=fiscal", "old.workers.dev", origin, true), "https://whittakergeo.com/calculations/new?calculator=state-rent&section=fiscal");
  assert.equal(canonicalPageUrl("/signin", "whittakergeo.com", origin, true), null);
  assert.equal(canonicalPageUrl("/signin", "WHITTAKERGEO.COM", origin, true), null);
  assert.equal(canonicalPageUrl("/signin", "127.0.0.1:3000", origin, false), null);
  assert.equal(canonicalPageUrl("/signin", "old.workers.dev", undefined, true), null);
});

test("canonical routing cannot send authentication to an untrusted path origin", () => {
  const origin = "https://whittakergeo.com";
  for (const path of ["//evil.example", "https://evil.example", "/\\evil.example", "/\nnext"])
    assert.equal(canonicalPageUrl(path, "old.workers.dev", origin, true), null);
  for (const value of ["bad", "http://whittakergeo.com", "https://name:secret@example.com"])
    assert.equal(canonicalPageUrl("/signin", "old.workers.dev", value, true), null);
});
