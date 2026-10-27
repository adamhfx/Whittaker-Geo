import {
  planModelUpgrade,
  updatedCalculationName,
  type ModelUpgradePlan,
} from "./model-updates";
import { validateInputs } from "./validation";
import type { Calculation, InputValues, Manifest } from "./types";

export type ModelUpgradeRequest = {
  targetVersion: string;
  sourceRevision: number;
  inputs: InputValues;
  name?: string;
  idempotencyKey: string;
};

export type ModelUpgradeModel = {
  manifest: Manifest;
  approved: boolean;
  currentVersion: string | null;
};

export type OwnedCalculation = Calculation & { user_id: string };

export interface ModelUpgradeRepository {
  findOwnedCalculation(
    id: string,
    userId: string,
  ): Promise<OwnedCalculation | null>;
  loadModel(
    calculatorId: string,
    version: string,
  ): Promise<ModelUpgradeModel | null>;
  saveCalculation(args: {
    userId: string;
    id: string;
    calculatorId: string;
    version: string;
    name: string;
    inputs: InputValues;
  }): Promise<OwnedCalculation>;
}

export class ModelUpgradeError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export class DuplicateCalculationIdError extends Error {}

export type ModelUpgradeResponse = {
  calculation: OwnedCalculation;
  migration: ModelUpgradePlan;
  replayed: boolean;
};

function conflict(message: string): ModelUpgradeError {
  return new ModelUpgradeError(409, message);
}

function sameInputValues(left: InputValues, right: InputValues) {
  if (
    !left ||
    typeof left !== "object" ||
    Array.isArray(left) ||
    !right ||
    typeof right !== "object" ||
    Array.isArray(right)
  )
    return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) => key === rightKeys[index] && left[key] === right[key],
    )
  );
}

function matchesIdempotentCopy(
  calculation: OwnedCalculation,
  args: {
    userId: string;
    calculatorId: string;
    targetVersion: string;
    name: string;
    inputs: InputValues;
  },
) {
  return (
    calculation.user_id === args.userId &&
    calculation.calculator_id === args.calculatorId &&
    calculation.calculator_version === args.targetVersion &&
    calculation.name === args.name &&
    sameInputValues(calculation.inputs, args.inputs)
  );
}

function assertCurrentApprovedTarget(
  model: ModelUpgradeModel | null,
  calculatorId: string,
  version: string,
) {
  if (
    !model ||
    model.manifest.id !== calculatorId ||
    model.manifest.version !== version ||
    model.currentVersion !== version ||
    !model.approved
  )
    throw conflict(
      "This model is no longer the approved latest version. Refresh and review the update again.",
    );
}

/**
 * Recomputes an update from the owned source record and the caller's current
 * source-version inputs. It inserts a new row only; it never changes the source.
 */
export async function createModelUpgrade(
  repository: ModelUpgradeRepository,
  userId: string,
  sourceId: string,
  request: ModelUpgradeRequest,
): Promise<ModelUpgradeResponse> {
  const source = await repository.findOwnedCalculation(sourceId, userId);
  if (!source) throw new ModelUpgradeError(404, "Calculation not found.");
  if (source.calculator_version === request.targetVersion)
    throw conflict("This project already uses that model version.");

  const [sourceModel, targetModel] = await Promise.all([
    repository.loadModel(source.calculator_id, source.calculator_version),
    repository.loadModel(source.calculator_id, request.targetVersion),
  ]);
  if (
    !sourceModel ||
    sourceModel.manifest.id !== source.calculator_id ||
    sourceModel.manifest.version !== source.calculator_version
  )
    throw conflict(
      "The saved model version is no longer available for migration.",
    );
  if (
    !targetModel ||
    targetModel.manifest.id !== source.calculator_id ||
    targetModel.manifest.version !== request.targetVersion
  )
    throw conflict("The requested model version is no longer available.");

  if (validateInputs(request.inputs, sourceModel.manifest, false).length)
    throw new ModelUpgradeError(
      400,
      "Current project inputs are invalid for the saved model version.",
    );

  let migration: ModelUpgradePlan;
  try {
    migration = planModelUpgrade(
      sourceModel.manifest,
      targetModel.manifest,
      request.inputs,
    );
  } catch {
    throw conflict(
      "These model versions cannot be safely compared for an update.",
    );
  }
  if (validateInputs(migration.inputs, targetModel.manifest, false).length)
    throw conflict(
      "The new model defaults or migrated values are not valid. Review the model before updating this project.",
    );
  const name = updatedCalculationName(
    source.name,
    request.targetVersion,
    request.name,
  );
  const expected = {
    userId,
    calculatorId: source.calculator_id,
    targetVersion: request.targetVersion,
    name,
    inputs: migration.inputs,
  };

  const returnMatchingExisting =
    async (): Promise<ModelUpgradeResponse | null> => {
      const existing = await repository.findOwnedCalculation(
        request.idempotencyKey,
        userId,
      );
      if (!existing) return null;
      if (!matchesIdempotentCopy(existing, expected))
        throw conflict(
          "This update key has already been used with different project contents.",
        );
      return { calculation: existing, migration, replayed: true };
    };

  // Recover a completed request before requiring the target to remain current;
  // this makes a lost response retry safe even after a later model activation.
  const existing = await returnMatchingExisting();
  if (existing) return existing;

  if (source.revision !== request.sourceRevision)
    throw conflict(
      "This project changed in another window. Reload it before updating.",
    );
  assertCurrentApprovedTarget(
    targetModel,
    source.calculator_id,
    request.targetVersion,
  );

  // Re-read the optimistic revision and current model immediately before the
  // insert so an edit or activation during planning cannot create a stale copy.
  const [freshSource, freshTarget] = await Promise.all([
    repository.findOwnedCalculation(sourceId, userId),
    repository.loadModel(source.calculator_id, request.targetVersion),
  ]);
  if (!freshSource || freshSource.revision !== request.sourceRevision)
    throw conflict(
      "This project changed in another window. Reload it before updating.",
    );
  assertCurrentApprovedTarget(
    freshTarget,
    source.calculator_id,
    request.targetVersion,
  );

  try {
    const calculation = await repository.saveCalculation({
      userId,
      id: request.idempotencyKey,
      calculatorId: source.calculator_id,
      version: request.targetVersion,
      name,
      inputs: migration.inputs,
    });
    return { calculation, migration, replayed: false };
  } catch (error) {
    if (!(error instanceof DuplicateCalculationIdError)) throw error;
    const retry = await returnMatchingExisting();
    if (retry) return retry;
    throw conflict(
      "This update key has already been used with different project contents.",
    );
  }
}

export function isModelUpgradeRequest(
  value: unknown,
): value is ModelUpgradeRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const request = value as Record<string, unknown>;
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return (
    typeof request.targetVersion === "string" &&
    request.targetVersion.trim().length > 0 &&
    request.targetVersion.length <= 100 &&
    Number.isInteger(request.sourceRevision) &&
    Number(request.sourceRevision) > 0 &&
    typeof request.idempotencyKey === "string" &&
    uuid.test(request.idempotencyKey) &&
    !!request.inputs &&
    typeof request.inputs === "object" &&
    !Array.isArray(request.inputs) &&
    (request.name === undefined ||
      (typeof request.name === "string" &&
        request.name.trim().length > 0 &&
        request.name.length <= 120))
  );
}
