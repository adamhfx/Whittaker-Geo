import assert from "node:assert/strict";
import test from "node:test";
import { deployPreview, extractVersionId } from "../scripts/deploy-cloudflare.mjs";

const commitSha = "a".repeat(40);
const versionId = "123e4567-e89b-12d3-a456-426614174000";
const env = {
  CLOUDFLARE_API_TOKEN: "test-token-that-is-not-logged",
  GITHUB_SHA: commitSha,
};

function mockRunner(results) {
  const calls = [];
  return {
    calls,
    run: async (args, options) => {
      calls.push({ args, options });
      const result = results.shift();
      if (!result) throw new Error("Unexpected Cloudflare CLI call.");
      return result;
    },
  };
}

test("uploads once, then deploys only that version to 100 percent without route commands", async () => {
  const runner = mockRunner([
    { code: 0, stdout: `Worker Version ID: ${versionId}\n`, stderr: "" },
    { code: 0, stdout: "Deployment created.\n", stderr: "" },
  ]);

  const result = await deployPreview({ env, run: runner.run });

  assert.deepEqual(result, { versionId, workerName: "geoflow-preview" });
  assert.deepEqual(runner.calls.map(({ args }) => args), [
    ["workers", "versions", "create", "--prebuilt", "--tag", commitSha],
    [
      "workers", "deployments", "create",
      "--worker", "geoflow-preview",
      "--strategy", "percentage",
      "--versions", JSON.stringify([{ version_id: versionId, percentage: 100 }]),
    ],
  ]);
  assert.equal(
    runner.calls.flatMap(({ args }) => args).some((arg) => /route/i.test(arg)),
    false,
  );
  assert.equal(runner.calls.length, 2);
});

test("version ID parsing accepts bare and clack-prefixed CRLF lines only", () => {
  assert.equal(extractVersionId(`Worker Version ID: ${versionId}\n`), versionId);
  assert.equal(
    extractVersionId(`│  Worker Version ID: ${versionId}\r\n`),
    versionId,
  );
  assert.throws(
    () => extractVersionId(`Upload details contain ${versionId}, but no labeled ID.`),
    /found 0/,
  );
});

test("a failed version upload never attempts a deployment", async () => {
  const runner = mockRunner([
    { code: 1, stdout: "", stderr: "Upload failed." },
  ]);

  await assert.rejects(
    deployPreview({ env, run: runner.run }),
    /Worker Version upload failed with exit code 1/,
  );
  assert.equal(runner.calls.length, 1);
  assert.deepEqual(runner.calls[0].args.slice(0, 3), [
    "workers", "versions", "create",
  ]);
});

test("upload failure diagnostics redact the API token", async () => {
  const runner = mockRunner([
    { code: 1, stdout: "", stderr: `Upload failed: ${env.CLOUDFLARE_API_TOKEN}` },
  ]);

  await assert.rejects(
    deployPreview({ env, run: runner.run }),
    (error) => {
      assert.equal(error.message.includes(env.CLOUDFLARE_API_TOKEN), false);
      assert.match(error.message, /\[REDACTED\]/);
      assert.equal(runner.calls.length, 1);
      return true;
    },
  );
});

test("missing or ambiguous version IDs never attempt a deployment", async (context) => {
  for (const [name, output] of [
    ["missing", "Upload succeeded without an ID."],
    ["ambiguous", `Worker Version ID: ${versionId}\nWorker Version ID: ${versionId}\n`],
  ]) {
    await context.test(name, async () => {
      const runner = mockRunner([{ code: 0, stdout: output, stderr: "" }]);
      await assert.rejects(deployPreview({ env, run: runner.run }), /Expected one Worker Version ID/);
      assert.equal(runner.calls.length, 1);
    });
  }
});

test("invalid credentials or commit SHA are rejected before invoking the CLI", async () => {
  let calls = 0;
  const run = async () => {
    calls += 1;
    return { code: 0, stdout: "", stderr: "" };
  };

  await assert.rejects(
    deployPreview({ env: { ...env, CLOUDFLARE_API_TOKEN: " " }, run }),
    /CLOUDFLARE_API_TOKEN is required/,
  );
  await assert.rejects(
    deployPreview({ env: { ...env, GITHUB_SHA: "short" }, run }),
    /full 40-character commit SHA/,
  );
  assert.equal(calls, 0);
});
