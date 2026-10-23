import { ApiError, body, failure, ok } from "../_route";
import { evaluateDraft, engineEndpoint, EngineEvaluationError } from "@/lib/evaluation";
import {
  canUseLocalModelReview,
  isLoopbackEngineUrl,
} from "@/lib/local-model-review";
import { validateInputs } from "@/lib/validation";
import { previewManifest } from "@/app/preview/manifest";
import type { InputValues, Manifest } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LOCAL_REVIEW_REQUESTER_ID = "00000000-0000-4000-8000-000000000001";

const candidateManifest = {
  ...previewManifest,
  outputs: previewManifest.outputViews.map((view) => view.sheet),
} as unknown as Manifest;

export async function POST(request: Request) {
  if (
    !canUseLocalModelReview({
      nodeEnv: process.env.NODE_ENV,
      enabled: process.env.LOCAL_MODEL_REVIEW,
      requestUrl: request.url,
      host: request.headers.get("host"),
      origin: request.headers.get("origin"),
    })
  ) {
    return failure(new ApiError(404, "Not found."));
  }

  try {
    const payload = await body(request);
    if (
      !payload ||
      typeof payload !== "object" ||
      Array.isArray(payload) ||
      payload.version !== candidateManifest.version ||
      !payload.inputs ||
      typeof payload.inputs !== "object" ||
      Array.isArray(payload.inputs)
    ) {
      throw new ApiError(400, "Invalid local review inputs.");
    }

    const inputs = payload.inputs as InputValues;
    const validationErrors = validateInputs(inputs, candidateManifest, true);
    if (validationErrors.length)
      throw new ApiError(400, validationErrors.slice(0, 4).join(" "));

    const secret = process.env.CALC_ENGINE_SECRET;
    if (!secret)
      throw new ApiError(
        503,
        "The local calculation service is not connected.",
      );

    const configuredEngine = process.env.CALC_ENGINE_URL;
    if (!isLoopbackEngineUrl(configuredEngine))
      throw new ApiError(
        503,
        "The local calculation service is not connected.",
      );

    let endpoint: string;
    try {
      endpoint = engineEndpoint(configuredEngine, true);
    } catch {
      throw new ApiError(
        503,
        "The local calculation service is not connected.",
      );
    }

    try {
      const result = await evaluateDraft({
        manifest: candidateManifest,
        inputs,
        requesterId: LOCAL_REVIEW_REQUESTER_ID,
        secret,
        endpoint,
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(25_000)]),
      });
      return ok({ result });
    } catch (error) {
      if (error instanceof Error && error.message === "ENGINE_BUSY")
        throw new ApiError(
          503,
          "The local calculation service is busy. Please retry.",
        );
      if (error instanceof EngineEvaluationError && error.code === "model_result_invalid")
        throw new ApiError(422, "The workbook returned an undefined result for this combination of inputs.");
      throw new ApiError(
        503,
        "Local model results could not be calculated. Please retry.",
      );
    }
  } catch (error) {
    return failure(error);
  }
}
