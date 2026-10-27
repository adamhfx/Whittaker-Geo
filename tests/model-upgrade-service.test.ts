import assert from "node:assert/strict";
import test from "node:test";
import {
  createModelUpgrade,
  DuplicateCalculationIdError,
  ModelUpgradeError,
  isModelUpgradeRequest,
  type ModelUpgradeRepository,
  type ModelUpgradeModel,
  type OwnedCalculation,
} from "../lib/model-upgrade-service";
import type { Field, InputValues, Manifest } from "../lib/types";

const userId = "user-a";
const sourceId = "source-project";
const key = "29b8b329-6d5a-4dd5-b6c0-e97c32c36a47";

function field(id: string, defaultValue: number): Field {
  return {
    id,
    cell: "A1",
    label: "Discount rate",
    unit: "%",
    group: "economics",
    type: "number",
    role: "discountRate",
    default: defaultValue,
    required: false,
    blankOnNew: false,
    min: 0,
    max: 100,
  };
}

function manifest(version: string, defaultValue: number): Manifest {
  return {
    id: "state-rent",
    version,
    name: "State Rent",
    description: "Test model",
    groups: [{ id: "economics", name: "Economics" }],
    fields: [field(`state-rent@${version}:ui!a1`, defaultValue)],
    releaseStatus: "approved",
    outputs: [],
    multipliers: [],
    runtimeSha256: "test",
  };
}

const sourceManifest = manifest("2.0.0", 19);
const targetManifest = manifest("2.1.0", 15);

function sourceCalculation(
  overrides: Partial<OwnedCalculation> = {},
): OwnedCalculation {
  return {
    id: sourceId,
    user_id: userId,
    calculator_id: "state-rent",
    calculator_version: "2.0.0",
    name: "Legacy project",
    inputs: { "state-rent@2.0.0:ui!a1": 18 },
    revision: 7,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
    ...overrides,
  };
}

function model(
  manifestValue: Manifest,
  overrides: Partial<ModelUpgradeModel> = {},
): ModelUpgradeModel {
  return {
    manifest: manifestValue,
    approved: true,
    currentVersion: "2.1.0",
    ...overrides,
  };
}

function createRepository(
  options: {
    source?: OwnedCalculation | null;
    targetModel?: ModelUpgradeModel | null;
    copies?: Map<string, OwnedCalculation>;
    saveMode?: "normal" | "insert-then-duplicate" | "duplicate-only";
    findSource?: (count: number) => OwnedCalculation | null;
  } = {},
) {
  const copies = options.copies ?? new Map<string, OwnedCalculation>();
  let sourceReads = 0;
  let saves = 0;
  const repository: ModelUpgradeRepository = {
    async findOwnedCalculation(id, owner) {
      if (owner !== userId) return null;
      if (id === sourceId) {
        sourceReads++;
        if (options.findSource) return options.findSource(sourceReads);
        if (Object.prototype.hasOwnProperty.call(options, "source"))
          return options.source ?? null;
        return sourceCalculation();
      }
      const copy = copies.get(id);
      return copy?.user_id === owner ? copy : null;
    },
    async loadModel(calculatorId, version) {
      if (calculatorId !== "state-rent") return null;
      if (version === "2.0.0") return model(sourceManifest);
      if (version === "2.1.0")
        return options.targetModel === undefined
          ? model(targetManifest)
          : options.targetModel;
      return null;
    },
    async saveCalculation(args) {
      saves++;
      if (options.saveMode === "duplicate-only")
        throw new DuplicateCalculationIdError();
      const calculation: OwnedCalculation = {
        id: args.id,
        user_id: args.userId,
        calculator_id: args.calculatorId,
        calculator_version: args.version,
        name: args.name,
        inputs: args.inputs,
        revision: 1,
        created_at: "2026-10-26T00:00:00Z",
        updated_at: "2026-10-26T00:00:00Z",
      };
      copies.set(args.id, calculation);
      if (options.saveMode === "insert-then-duplicate")
        throw new DuplicateCalculationIdError();
      return calculation;
    },
  };
  return {
    repository,
    copies,
    get saves() {
      return saves;
    },
  };
}

const request = (
  overrides: Partial<{
    targetVersion: string;
    sourceRevision: number;
    inputs: InputValues;
    name?: string;
    idempotencyKey: string;
  }> = {},
) => ({
  targetVersion: "2.1.0",
  sourceRevision: 7,
  inputs: { "state-rent@2.0.0:ui!a1": 19 },
  idempotencyKey: key,
  ...overrides,
});

test("accepts only bounded update requests with a UUID idempotency key", () => {
  assert.equal(isModelUpgradeRequest(request()), true);
  assert.equal(
    isModelUpgradeRequest({ ...request(), targetVersion: "   " }),
    false,
  );
  assert.equal(
    isModelUpgradeRequest({ ...request(), sourceRevision: "7" }),
    false,
  );
  assert.equal(
    isModelUpgradeRequest({ ...request(), idempotencyKey: "not-a-uuid" }),
    false,
  );
  assert.equal(isModelUpgradeRequest({ ...request(), name: "   " }), false);
  assert.equal(isModelUpgradeRequest({ ...request(), inputs: [] }), false);
});

test("creates an independent copy from current source edits, not only saved row values", async () => {
  const store = createRepository();
  const original = sourceCalculation();
  const result = await createModelUpgrade(
    store.repository,
    userId,
    sourceId,
    request(),
  );
  assert.equal(result.replayed, false);
  assert.equal(result.calculation.id, key);
  assert.equal(result.calculation.calculator_version, "2.1.0");
  assert.equal(result.calculation.name, "Legacy project (updated to 2.1.0)");
  assert.deepEqual(result.calculation.inputs, { "state-rent@2.1.0:ui!a1": 19 });
  assert.equal(result.migration.copiedCount, 1);
  assert.deepEqual(result.migration.defaultChanges, [
    {
      id: "state-rent@2.1.0:ui!a1",
      label: "Discount rate",
      current: 19,
      newDefault: 15,
    },
  ]);
  assert.deepEqual(original, sourceCalculation());
  assert.equal(store.saves, 1);
});

test("hides calculations owned by another user and never inserts from them", async () => {
  const store = createRepository({ source: null });
  await assert.rejects(
    createModelUpgrade(store.repository, "user-b", sourceId, request()),
    (error: unknown) =>
      error instanceof ModelUpgradeError && error.status === 404,
  );
  assert.equal(store.saves, 0);
});

test("rejects a stale source revision before creating a copy", async () => {
  const store = createRepository();
  await assert.rejects(
    createModelUpgrade(
      store.repository,
      userId,
      sourceId,
      request({ sourceRevision: 6 }),
    ),
    (error: unknown) =>
      error instanceof ModelUpgradeError && error.status === 409,
  );
  assert.equal(store.saves, 0);
});

test("rechecks the source revision just before insert to catch a concurrent edit", async () => {
  const store = createRepository({
    findSource: (count) => sourceCalculation({ revision: count >= 2 ? 8 : 7 }),
  });
  await assert.rejects(
    createModelUpgrade(store.repository, userId, sourceId, request()),
    (error: unknown) =>
      error instanceof ModelUpgradeError && error.status === 409,
  );
  assert.equal(store.saves, 0);
});

test("rechecks the active version just before insert", async () => {
  const store = createRepository();
  let targetReads = 0;
  const repository: ModelUpgradeRepository = {
    ...store.repository,
    async loadModel(calculatorId, version) {
      const loaded = await store.repository.loadModel(calculatorId, version);
      if (version !== "2.1.0" || !loaded) return loaded;
      targetReads++;
      return targetReads >= 2 ? { ...loaded, currentVersion: "2.2.0" } : loaded;
    },
  };
  await assert.rejects(
    createModelUpgrade(repository, userId, sourceId, request()),
    (error: unknown) =>
      error instanceof ModelUpgradeError && error.status === 409,
  );
  assert.equal(store.saves, 0);
});

test("requires the requested target to be the approved current version", async () => {
  for (const targetModel of [
    model(targetManifest, { approved: false }),
    model(targetManifest, { currentVersion: "2.2.0" }),
  ]) {
    const store = createRepository({ targetModel });
    await assert.rejects(
      createModelUpgrade(store.repository, userId, sourceId, request()),
      (error: unknown) =>
        error instanceof ModelUpgradeError && error.status === 409,
    );
    assert.equal(store.saves, 0);
  }
});

test("validates current source-version edits and does not accept unknown fields", async () => {
  const store = createRepository();
  for (const inputs of [
    { "state-rent@2.0.0:ui!a1": 19, unknown: 1 },
    { "state-rent@2.0.0:ui!a1": 101 },
  ] as InputValues[]) {
    await assert.rejects(
      createModelUpgrade(
        store.repository,
        userId,
        sourceId,
        request({ inputs }),
      ),
      (error: unknown) =>
        error instanceof ModelUpgradeError && error.status === 400,
    );
  }
  assert.equal(store.saves, 0);
});

test("returns the existing owned copy for a matching lost-response retry", async () => {
  const store = createRepository();
  const first = await createModelUpgrade(
    store.repository,
    userId,
    sourceId,
    request(),
  );
  const second = await createModelUpgrade(
    store.repository,
    userId,
    sourceId,
    request(),
  );
  assert.equal(first.calculation.id, second.calculation.id);
  assert.equal(second.replayed, true);
  assert.equal(store.saves, 1);
});

test("recovers a matching lost-response retry after the source was edited later", async () => {
  let currentRevision = 7;
  const store = createRepository({
    findSource: () => sourceCalculation({ revision: currentRevision }),
  });
  const first = await createModelUpgrade(
    store.repository,
    userId,
    sourceId,
    request(),
  );
  currentRevision = 8;
  const retry = await createModelUpgrade(
    store.repository,
    userId,
    sourceId,
    request(),
  );
  assert.equal(retry.calculation.id, first.calculation.id);
  assert.equal(retry.replayed, true);
  assert.equal(store.saves, 1);
});

test("rejects a reused key with different migrated contents", async () => {
  const store = createRepository();
  await createModelUpgrade(store.repository, userId, sourceId, request());
  await assert.rejects(
    createModelUpgrade(
      store.repository,
      userId,
      sourceId,
      request({
        inputs: { "state-rent@2.0.0:ui!a1": 20 },
      }),
    ),
    (error: unknown) =>
      error instanceof ModelUpgradeError && error.status === 409,
  );
  assert.equal(store.saves, 1);
});

test("recovers a matching row after a concurrent duplicate-key insert", async () => {
  const store = createRepository({ saveMode: "insert-then-duplicate" });
  const result = await createModelUpgrade(
    store.repository,
    userId,
    sourceId,
    request(),
  );
  assert.equal(result.replayed, true);
  assert.equal(result.calculation.id, key);
  assert.equal(store.saves, 1);
});

test("rejects a conflicting or unowned row after a duplicate-key insert", async () => {
  const store = createRepository({ saveMode: "duplicate-only" });
  await assert.rejects(
    createModelUpgrade(store.repository, userId, sourceId, request()),
    (error: unknown) =>
      error instanceof ModelUpgradeError && error.status === 409,
  );
  assert.equal(store.saves, 1);
});
