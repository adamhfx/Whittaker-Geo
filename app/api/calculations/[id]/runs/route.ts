import { actor, body, dbError, failure, ok, owned, ApiError } from "../../../_route";
import { manifestFor } from "@/lib/server";
import { validateInputs } from "@/lib/validation";
import { savedRunsEnabled } from "@/lib/saved-runs";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { user, db } = await actor(request);
    if (!savedRunsEnabled())
      throw new ApiError(503, "Saved runs and new Excel exports are temporarily unavailable. You can still save inputs and view live results.");
    const key = request.headers.get("idempotency-key");
    if (
      !key ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        key,
      )
    )
      throw new Error("bad");
    const b = await body(request);
    if (typeof b?.revision !== "number") throw new Error("bad");
    const c = await owned(db, "calculations", (await params).id, user.id);
    const { manifest } = await manifestFor(
      c.calculator_id,
      c.calculator_version,
    );
    if (validateInputs(c.inputs, manifest, true).length) throw new Error("bad");
    const { data, error } = await db.rpc("submit_run", {
      p_user: user.id,
      p_calculation: c.id,
      p_revision: b.revision,
      p_key: key,
    });
    if (error) dbError(error.message);
    return ok({ run: data }, 201);
  } catch (e) {
    return failure(e);
  }
}
