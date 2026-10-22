import { actor, body, failure, manifestFor, ok, ApiError } from "../../../_route";
import { paidAccess, validateInputs } from "@/lib/validation";
import { engineEndpoint, evaluateDraft } from "@/lib/evaluation";

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
    try {
      const result = await evaluateDraft({ manifest, inputs: payload.inputs, requesterId: user.id,
        secret, endpoint, signal: AbortSignal.any([request.signal, AbortSignal.timeout(25_000)]) });
      return ok({ result });
    } catch (error) {
      if (error instanceof Error && error.message === "ENGINE_BUSY")
        throw new ApiError(503, "The calculation service is busy. Your inputs are preserved; please retry.");
      throw new ApiError(503, "Live results could not be calculated. Your inputs are preserved; please retry.");
    }
  } catch (error) { return failure(error); }
}
