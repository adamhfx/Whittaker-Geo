import { actor, body, failure, manifestFor, ok, ApiError } from "../../../_route";
import { paidAccess, validateInputs } from "@/lib/validation";
import { engineEndpoint, evaluateDraft, EngineEvaluationError } from "@/lib/evaluation";

function retryableCalculationResponse(message: string) {
  return Response.json(
    { error: message },
    {
      status: 503,
      headers: { "Cache-Control": "private, no-store", "Retry-After": "5" },
    },
  );
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user, db } = await actor(request);
    const payload = await body(request);
    if (!payload || typeof payload.version !== "string" || payload.version.length > 100 ||
      !payload.inputs || typeof payload.inputs !== "object" || Array.isArray(payload.inputs))
      throw new ApiError(400, "Invalid calculation inputs.");
    const { manifest, approved } = await manifestFor((await params).id, payload.version);
    if (!approved) throw new ApiError(409, "This model is awaiting numerical approval. Live results are unavailable.");
    const { data: subscription, error } = await db.from("subscriptions")
      .select("status,paid_until").eq("user_id", user.id).maybeSingle();
    if (error) throw new ApiError(503, "Unable to verify workspace access. Please retry.");
    if (!paidAccess(subscription)) throw new ApiError(402, "An active subscription is required for live calculations.");
    const errors = validateInputs(payload.inputs, manifest, true);
    if (errors.length) throw new ApiError(400, errors.slice(0, 4).join(" "));
    const secret = process.env.CALC_ENGINE_SECRET;
    if (!secret) throw new ApiError(503, "The live calculation service is not connected yet.");
    let endpoint: string;
    try { endpoint = engineEndpoint(process.env.CALC_ENGINE_URL, process.env.NODE_ENV === "development"); }
    catch { throw new ApiError(503, "The live calculation service is not connected yet."); }
    const timeoutSignal = AbortSignal.timeout(25_000);
    try {
      const result = await evaluateDraft({ manifest, inputs: payload.inputs, requesterId: user.id,
        secret, endpoint, signal: AbortSignal.any([request.signal, timeoutSignal]) });
      if (!request.signal.aborted && timeoutSignal.aborted) {
        return retryableCalculationResponse(
          "This calculation is taking longer than expected. Retrying shortly.",
        );
      }
      return ok({ result });
    } catch (error) {
      // A disconnected browser should never cause a retry for a newer snapshot.
      // Only this route's own deadline is reported as retryable service-busy.
      if (!request.signal.aborted && timeoutSignal.aborted) {
        return retryableCalculationResponse(
          "This calculation is taking longer than expected. Retrying shortly.",
        );
      }
      if (error instanceof Error && error.message === "ENGINE_BUSY")
        return retryableCalculationResponse(
          "The calculation service is busy. Your inputs are preserved; please retry.",
        );
      console.error(JSON.stringify({
        event: "live_calculation_failed",
        code: error instanceof EngineEvaluationError ? error.code
          : request.signal.aborted ? "request_aborted" : "unexpected",
      }));
      throw new ApiError(503, "Live results could not be calculated. Your inputs are preserved; please retry.");
    }
  } catch (error) { return failure(error); }
}
