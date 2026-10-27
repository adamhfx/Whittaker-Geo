import { ApiError, actor, body, dbError, failure, ok } from "../../../_route";
import type { Manifest } from "@/lib/types";
import {
  createModelUpgrade,
  DuplicateCalculationIdError,
  isModelUpgradeRequest,
  ModelUpgradeError,
  type OwnedCalculation,
  type ModelUpgradeRepository,
} from "@/lib/model-upgrade-service";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { user, db } = await actor(request);
    const sourceId = (await params).id;
    const rawBody = await body(request);
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        sourceId,
      ) ||
      !isModelUpgradeRequest(rawBody)
    )
      throw new Error("bad");

    const repository: ModelUpgradeRepository = {
      async findOwnedCalculation(id, userId) {
        const { data, error } = await db
          .from("calculations")
          .select("*")
          .eq("id", id)
          .eq("user_id", userId)
          .maybeSingle();
        if (error) dbError(error.message);
        return data as OwnedCalculation | null;
      },
      async loadModel(calculatorId, version) {
        const [calculator, model] = await Promise.all([
          db
            .from("calculators")
            .select("current_version")
            .eq("id", calculatorId)
            .maybeSingle(),
          db
            .from("calculator_versions")
            .select("manifest,approved")
            .eq("calculator_id", calculatorId)
            .eq("version", version)
            .maybeSingle(),
        ]);
        if (calculator.error) dbError(calculator.error.message);
        if (model.error) dbError(model.error.message);
        if (!calculator.data || !model.data) return null;
        return {
          manifest: model.data.manifest as Manifest,
          approved: model.data.approved === true,
          currentVersion: calculator.data.current_version as string | null,
        };
      },
      async saveCalculation(args) {
        const { data, error } = await db.rpc("save_calculation", {
          p_user: args.userId,
          p_id: args.id,
          p_calculator: args.calculatorId,
          p_version: args.version,
          p_name: args.name,
          p_inputs: args.inputs,
        });
        if (error) {
          if (error.code === "23505") throw new DuplicateCalculationIdError();
          dbError(error.message);
        }
        if (!data) throw new Error("Calculation copy was not returned.");
        return data as OwnedCalculation;
      },
    };

    const result = await createModelUpgrade(
      repository,
      user.id,
      sourceId,
      rawBody,
    );
    const migration = {
      copiedCount: result.migration.copiedCount,
      reviewFields: result.migration.reviewFields,
      defaultChanges: result.migration.defaultChanges,
      removedCount: result.migration.removedCount,
    };
    return ok(
      { calculation: result.calculation, migration },
      result.replayed ? 200 : 201,
    );
  } catch (error) {
    if (error instanceof ModelUpgradeError)
      return failure(new ApiError(error.status, error.message));
    return failure(error);
  }
}
