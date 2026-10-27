import crypto from "node:crypto";
import {
  actor,
  ApiError,
  body,
  dbError,
  failure,
  manifestFor,
  ok,
  validateInputs,
} from "../_route";
export async function POST(request: Request) {
  try {
    const { user, db } = await actor(request);
    const b = await body(request);
    if (
      typeof b?.name !== "string" ||
      b.name.length < 1 ||
      b.name.length > 120 ||
      typeof b?.calculatorId !== "string" ||
      !b?.inputs ||
      typeof b.inputs !== "object"
    )
      throw new Error("bad");
    const version = typeof b.version === "string" ? b.version : undefined;
    const { manifest } = await manifestFor(b.calculatorId);
    // New projects start on the active release. Existing projects and their
    // duplicates keep their explicit version through their separate routes.
    if (version && version !== manifest.version)
      throw new ApiError(
        409,
        "A newer model is available. Review the model update in your draft before saving.",
      );
    const v = validateInputs(b.inputs, manifest, false);
    if (v.length) throw new Error("bad");
    const { data, error } = await db.rpc("save_calculation", {
      p_user: user.id,
      p_id: crypto.randomUUID(),
      p_calculator: b.calculatorId,
      p_version: manifest.version,
      p_name: b.name,
      p_inputs: b.inputs,
    });
    if (error) dbError(error.message);
    return ok({ calculation: data }, 201);
  } catch (e) {
    return failure(e);
  }
}
