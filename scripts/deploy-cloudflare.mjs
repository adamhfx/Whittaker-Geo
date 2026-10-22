import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CF_ENTRYPOINT = path.join(REPO_ROOT, "node_modules", "cf", "bin", "cf");
const WORKER_NAME = "geoflow-preview";
const UUID_PATTERN = "[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}";
const MAX_CAPTURED_OUTPUT = 256_000;

function capture(stream) {
  let output = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    if (output.length < MAX_CAPTURED_OUTPUT) {
      output += chunk.slice(0, MAX_CAPTURED_OUTPUT - output.length);
    }
  });
  return () => output;
}

function runCloudflareCli(args, { env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CF_ENTRYPOINT, ...args], {
      cwd: REPO_ROOT,
      env: { ...env, NO_COLOR: "1" },
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = capture(child.stdout);
    const stderr = capture(child.stderr);
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout: stdout(), stderr: stderr() }));
  });
}

export function extractVersionId(output) {
  const pattern = new RegExp(
    `^[ \\t]*(?:│[ \\t]*)?Worker Version ID:[ \\t]*(${UUID_PATTERN})[ \\t]*\\r?$`,
    "gim",
  );
  const matches = [...output.matchAll(pattern)];
  if (matches.length !== 1) {
    throw new Error(
      `Expected one Worker Version ID in the upload output; found ${matches.length}.`,
    );
  }
  return matches[0][1];
}

function commandError(operation, result, env) {
  const token = typeof env.CLOUDFLARE_API_TOKEN === "string"
    ? env.CLOUDFLARE_API_TOKEN
    : "";
  const detail = [result.stderr, result.stdout]
    .filter(Boolean)
    .join("\n")
    .replaceAll(token, "[REDACTED]")
    .slice(-2_000)
    .trim();
  return new Error(
    `${operation} failed with exit code ${result.code ?? "unknown"}${detail ? `: ${detail}` : "."}`,
  );
}

export async function deployPreview({ env = process.env, run = runCloudflareCli } = {}) {
  if (!env.CLOUDFLARE_API_TOKEN?.trim()) {
    throw new Error("CLOUDFLARE_API_TOKEN is required for preview deployment.");
  }
  const commitSha = env.GITHUB_SHA;
  if (typeof commitSha !== "string" || !/^[0-9a-f]{40}$/i.test(commitSha)) {
    throw new Error("GITHUB_SHA must be a full 40-character commit SHA.");
  }

  const uploadArgs = [
    "workers", "versions", "create", "--prebuilt", "--tag", commitSha,
  ];
  const upload = await run(uploadArgs, { env });
  if (upload.code !== 0) {
    throw commandError("Worker Version upload", upload, env);
  }

  const versionId = extractVersionId(`${upload.stdout}\n${upload.stderr}`);
  const deploymentArgs = [
    "workers", "deployments", "create",
    "--worker", WORKER_NAME,
    "--strategy", "percentage",
    "--versions", JSON.stringify([{ version_id: versionId, percentage: 100 }]),
  ];
  const deployment = await run(deploymentArgs, { env });
  if (deployment.code !== 0) {
    throw commandError("Worker Version deployment", deployment, env);
  }

  console.log(`Uploaded and deployed Worker Version ${versionId} to ${WORKER_NAME}.`);
  return { versionId, workerName: WORKER_NAME };
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath && invokedPath === fileURLToPath(import.meta.url)) {
  deployPreview().catch((error) => {
    console.error(error instanceof Error ? error.message : "Cloudflare preview deployment failed.");
    process.exitCode = 1;
  });
}
