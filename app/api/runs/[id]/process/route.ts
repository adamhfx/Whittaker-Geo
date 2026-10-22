import { actor, ApiError, dbError, failure, manifestFor, ok, owned } from "../../../_route";
import { engineEndpoint, EngineEvaluationError, evaluateSavedDraft } from "@/lib/evaluation";
import { savedRunsEnabled } from "@/lib/saved-runs";

// An explicit browser POST drives one immutable snapshot. No background process
// or scheduler is needed; a later request can reclaim an interrupted lease.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user, db } = await actor(request);
    if (!savedRunsEnabled()) throw new ApiError(503, "Saved runs are temporarily unavailable.");
    const id = (await params).id;
    const run = await owned(db, "runs", id, user.id);
    if (!["queued", "running"].includes(run.status)) return ok({ run });
    const token = crypto.randomUUID();
    const { data: claimed, error } = await db.rpc("claim_requested_run", {
      p_user: user.id, p_run: id, p_token: token,
    });
    if (error) dbError(error.message);
    if (!claimed) return ok({ run: await owned(db, "runs", id, user.id) }, 202);

    const finish = async (outcome: string, path: string | null = null, result: unknown = null) => {
      const response = await db.rpc("finish_requested_run", {
        p_user: user.id, p_run: id, p_token: token,
        p_outcome: outcome, p_export: path, p_result: result,
      });
      if (response.error) throw new Error("PUBLICATION_UNAVAILABLE");
      return response.data === true;
    };
    let publicationAttempted = false;
    try {
      const { manifest, approved } = await manifestFor(run.calculator_id, run.calculator_version);
      if (!approved) throw new Error("MODEL_REVIEW_REQUIRED");
      const secret = process.env.CALC_ENGINE_SECRET;
      if (!secret) throw new Error("ENGINE_NOT_CONFIGURED");
      const { result, workbook } = await evaluateSavedDraft({
        manifest, inputs: run.inputs, requesterId: user.id, secret,
        endpoint: engineEndpoint(process.env.CALC_ENGINE_URL, process.env.NODE_ENV === "development", "export"),
        // Do not bind completion to a browser disconnect. If the runtime stops,
        // the durable lease still permits a later request to recover the run.
        signal: AbortSignal.timeout(90_000),
      });
      const path = `${user.id}/${id}/${token}.xlsx`;
      const upload = await db.storage.from("calculation-exports").upload(path, workbook, {
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", upsert: false,
      });
      if (upload.error) throw new Error("STORAGE_UNAVAILABLE");
      // If the reply is lost after commit, leave publication untouched. Never
      // remove a file that a successfully committed run may already reference.
      publicationAttempted = true;
      await finish("succeeded", path, result);
    } catch (error) {
      const retryable = error instanceof Error && (
        ["ENGINE_BUSY", "STORAGE_UNAVAILABLE"].includes(error.message) ||
        ["AbortError", "TimeoutError"].includes(error.name) ||
        error instanceof EngineEvaluationError && error.code === "connection_failed"
      );
      if (!publicationAttempted) await finish(retryable ? "retry" : "failed");
      console.error(JSON.stringify({ event: "saved_calculation_pending_or_failed",
        code: publicationAttempted ? "publication_uncertain" : retryable ? "retry" : "calculation_failed" }));
    }
    return ok({ run: await owned(db, "runs", id, user.id) });
  } catch (error) {
    return failure(error);
  }
}
