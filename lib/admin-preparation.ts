import "server-only";
import { ApiError } from "./server";
import { publicManifest } from "./public-manifest";
import { parseLiveResult } from "./evaluation";
import {
  preparationEngine,
  PreparationEngineError,
} from "./preparation-engine";
import type { Manifest } from "./types";
import { modelGuide } from "./model-guide";

export async function preparationRecord(db: any, id: string) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  )
    throw new ApiError(404, "Workbook upload not found.");
  const [{ data: upload, error: uploadError }, { data: job, error: jobError }] =
    await Promise.all([
      db.from("model_uploads").select("*").eq("id", id).maybeSingle(),
      db
        .from("model_preparations")
        .select("*")
        .eq("upload_id", id)
        .maybeSingle(),
    ]);
  if (uploadError || jobError)
    throw new ApiError(
      503,
      "Model review is temporarily unavailable. Please retry.",
    );
  if (!upload) throw new ApiError(404, "Workbook upload not found.");
  const { data: calculator, error } = await db
    .from("calculators")
    .select("id,name,current_version")
    .eq("id", upload.calculator_id)
    .single();
  if (error || !calculator) throw new ApiError(404, "Calculator not found.");
  return { upload, job, calculator };
}

export async function preparationView(db: any, id: string) {
  const { upload, job, calculator } = await preparationRecord(db, id);
  let baseline = null;
  if (job?.manifest && job.baseline_result) {
    try {
      baseline = parseLiveResult(job.baseline_result, job.manifest);
    } catch {
      /* Never expose malformed engine payloads. */
    }
  }
  return {
    id,
    fileName: upload.file_name,
    notes: upload.notes,
    uploadedAt: upload.created_at,
    sourceStatus: upload.status,
    calculatorId: calculator.id,
    calculatorName: calculator.name,
    baseVersion: upload.base_version,
    currentVersion: calculator.current_version,
    sourceSha256: upload.sha256,
    revision: job?.revision ?? 1,
    state: job?.state ?? "queued",
    phase: job?.phase ?? "analyze",
    candidateVersion: job?.candidate_version ?? null,
    mapping: job?.mapping ?? {},
    report: job?.mapping_report ?? {},
    manifest: job?.manifest ? publicManifest(job.manifest) : null,
    baseline,
    checks: job?.validations ?? {},
    scenarios: job?.scenarios ?? [],
    scenarioIndex: job?.scenario_index ?? 0,
    reviewHash: job?.review_hash ?? null,
    error: job?.error ?? null,
    leaseUntil: job?.lease_until ?? null,
    hasExport: !!job?.export_path,
    approvedAt: job?.approved_at ?? null,
    approvalNotes: job?.approval_notes ?? null,
  };
}

export function preparationConflict(error: { message?: string } | null) {
  const message = error?.message ?? "";
  if (message.includes("ACTIVE_MODEL_CHANGED"))
    throw new ApiError(
      409,
      "The live model changed after this upload. Upload the workbook again against the current version before approving it.",
    );
  if (message.includes("PREPARATION_BUSY"))
    throw new ApiError(
      409,
      "A preparation step is running. Wait for it to finish before editing the mapping.",
    );
  if (message.includes("PREPARATION_CONFLICT"))
    throw new ApiError(
      409,
      "This review changed in another window. Reload it before continuing.",
    );
  if (message.includes("ADMIN_REQUIRED"))
    throw new ApiError(403, "Administrator access is required.");
  throw new ApiError(
    409,
    "The candidate cannot be released. Finish its checks and review the current results first.",
  );
}

export async function processPreparation(db: any, id: string, actorId: string) {
  const { upload } = await preparationRecord(db, id);
  if (upload.status !== "review_required")
    throw new ApiError(409, "This upload has already been reviewed.");
  const { data: base, error: baseError } = await db
    .from("calculator_versions")
    .select("manifest")
    .eq("calculator_id", upload.calculator_id)
    .eq("version", upload.base_version)
    .single();
  if (baseError || !base?.manifest)
    throw new ApiError(409, "The base model is unavailable.");
  // Retain display corrections already in use on the released site. New
  // candidate IDs must not resurrect the original generic workbook notes.
  const help: Record<string, unknown> = {};
  for (const kind of ["fields", "groups"] as const)
    for (const item of base.manifest[kind]) {
      const note = modelGuide(
        base.manifest.id,
        base.manifest.version,
        kind,
        item.id,
        item.help,
      );
      if (JSON.stringify(note ?? null) !== JSON.stringify(item.help ?? null))
        help[item.id] = note ?? null;
    }
  const token = crypto.randomUUID();
  const { data: claim, error } = await db.rpc("claim_model_preparation", {
    p_upload: id,
    p_actor: actorId,
    p_token: token,
    p_initial_mapping: Object.keys(help).length ? { help } : {},
  });
  if (error)
    throw new ApiError(
      503,
      "Preparation could not start. Your upload is saved; please retry.",
    );
  let retry = false;
  if (claim) {
    try {
      await preparationEngine(
        "prepare",
        { uploadId: id, actorId, leaseToken: token },
        {
          url: process.env.CALC_ENGINE_URL,
          secret: process.env.CALC_ENGINE_SECRET,
          development: process.env.NODE_ENV === "development",
        },
      );
    } catch (caught) {
      retry = caught instanceof PreparationEngineError && caught.retryable;
      // A late response may already have published the step. Fenced completion
      // can release only our still-current lease, never a completed/newer step.
      await db.rpc("finish_model_preparation", {
        p_upload: id,
        p_actor: actorId,
        p_token: token,
        p_outcome: retry ? "retry" : "failed",
        p_data: retry
          ? {}
          : {
              error:
                "The calculation service could not validate this candidate. Review the workbook formulas and input defaults, then retry preparation.",
            },
      });
    }
  }
  return { review: await preparationView(db, id), retry };
}

export async function reviewInputs(
  db: any,
  id: string,
  actorId: string,
  version: string,
  inputs: Record<string, unknown>,
) {
  const { job } = await preparationRecord(db, id);
  if (
    !job?.manifest ||
    job.candidate_version !== version ||
    !["ready", "approved", "failed"].includes(job.state) ||
    !job.runtime_path
  )
    throw new ApiError(
      409,
      "Finish preparation and reload the current candidate before calculating.",
    );
  const { validateInputs } = await import("./validation");
  const errors = validateInputs(inputs as any, job.manifest as Manifest, true);
  if (errors.length) throw new ApiError(422, errors.slice(0, 8).join(" "));
  try {
    const value = await preparationEngine(
      "review",
      { uploadId: id, actorId, version, inputs },
      {
        url: process.env.CALC_ENGINE_URL,
        secret: process.env.CALC_ENGINE_SECRET,
        development: process.env.NODE_ENV === "development",
      },
    );
    return parseLiveResult(value, job.manifest);
  } catch {
    throw new ApiError(
      503,
      "The trial calculation could not finish. The free engine may be starting or busy. Retry, or review the scenario inputs if the problem continues.",
    );
  }
}
