import { z } from "zod";
import { adminActor } from "@/lib/admin";
import { body, ApiError, failure, ok } from "../../../_route";
import {
  preparationRecord,
  preparationView,
  preparationConflict,
  processPreparation,
  reviewInputs,
} from "@/lib/admin-preparation";

type Context = { params: Promise<{ id: string }> };
const revision = z.number().int().min(1).max(1_000_000);
const action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("process") }).strict(),
  z
    .object({
      action: z.literal("evaluate"),
      version: z.string().min(1).max(100),
      inputs: z
        .record(
          z.string(),
          z.union([z.string().max(200), z.number().finite(), z.null()]),
        )
        .refine((value) => Object.keys(value).length <= 500),
    })
    .strict(),
  z
    .object({
      action: z.literal("approve"),
      revision,
      reviewHash: z.string().regex(/^[0-9a-f]{32}$/),
      expectedBase: z.string().min(1).max(100),
      acknowledged: z.literal(true),
      notes: z.string().max(1000),
    })
    .strict(),
  z.object({ action: z.literal("export") }).strict(),
]);

export async function GET(request: Request, context: Context) {
  try {
    const { db } = await adminActor(request);
    return ok({ review: await preparationView(db, (await context.params).id) });
  } catch (error) {
    return failure(error);
  }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const { db, user } = await adminActor(request);
    const { id } = await context.params;
    const value = z
      .object({ revision, mapping: z.record(z.string(), z.unknown()) })
      .strict()
      .safeParse(await body(request));
    if (!value.success)
      throw new ApiError(400, "Choose a valid mapping revision.");
    await preparationRecord(db, id);
    const { error } = await db.rpc("revise_model_preparation", {
      p_upload: id,
      p_actor: user.id,
      p_revision: value.data.revision,
      p_mapping: value.data.mapping,
    });
    if (error) preparationConflict(error);
    return ok({ review: await preparationView(db, id) });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request, context: Context) {
  try {
    const { db, user } = await adminActor(request);
    const { id } = await context.params;
    const parsed = action.safeParse(await body(request));
    if (!parsed.success)
      throw new ApiError(400, "Choose a valid model review action.");
    const value = parsed.data;
    if (value.action === "process")
      return ok(await processPreparation(db, id, user.id));
    if (value.action === "evaluate")
      return ok({
        result: await reviewInputs(
          db,
          id,
          user.id,
          value.version,
          value.inputs,
        ),
      });
    const { job } = await preparationRecord(db, id);
    if (value.action === "export") {
      if (
        !job?.export_path ||
        !job.export_path.startsWith(
          `model-reviews/${id}/${job.candidate_version}/`,
        )
      )
        throw new ApiError(
          409,
          "Finish export validation before downloading this workbook.",
        );
      const { data, error } = await db.storage
        .from("calculation-exports")
        .createSignedUrl(job.export_path, 120, {
          download: "model-review-results.xlsx",
        });
      if (error || !data?.signedUrl)
        throw new ApiError(
          503,
          "The review workbook is temporarily unavailable.",
        );
      return ok({ url: data.signedUrl });
    }
    const { error } = await db.rpc("approve_model_preparation", {
      p_upload: id,
      p_actor: user.id,
      p_revision: value.revision,
      p_review_hash: value.reviewHash,
      p_expected_base: value.expectedBase,
      p_acknowledged: value.acknowledged,
      p_notes: value.notes,
    });
    if (error) preparationConflict(error);
    return ok({ review: await preparationView(db, id) });
  } catch (error) {
    return failure(error);
  }
}
