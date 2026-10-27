import { inputOptions, isFluidUnit } from "./input-options";
import { initialInputs, validateInputs } from "./validation";
import type { Field, InputValues, Manifest } from "./types";

export type ModelUpgradeReviewField = {
  id: string;
  label: string;
  reason: string;
};

export type ModelUpgradeDefaultChange = {
  id: string;
  label: string;
  current: string | number | null;
  newDefault: string | number | null;
};

export type ModelUpgradePlan = {
  inputs: InputValues;
  copiedCount: number;
  reviewFields: ModelUpgradeReviewField[];
  defaultChanges: ModelUpgradeDefaultChange[];
  removedCount: number;
};

function normalizedText(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function normalizedUnit(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function semanticIdentity(field: Field) {
  return JSON.stringify([
    normalizedText(field.label),
    normalizedUnit(field.unit),
    normalizedText(field.type),
    normalizedText(field.group),
    field.year ?? null,
    normalizedText(field.role ?? ""),
  ]);
}

/**
 * Versioned model manifests prefix field ids with `calculator@version:`.
 * Strip only that known prefix; a suffix such as a cell address is never
 * treated as an identity on its own.
 */
function normalizedFieldId(field: Field, manifest: Manifest) {
  const prefix = `${manifest.id}@${manifest.version}:`;
  return field.id.startsWith(prefix) ? field.id.slice(prefix.length) : field.id;
}

function groupFields(fields: Field[], getKey: (field: Field) => string) {
  const grouped = new Map<string, Field[]>();
  for (const field of fields) {
    const key = getKey(field);
    const group = grouped.get(key) ?? [];
    group.push(field);
    grouped.set(key, group);
  }
  return grouped;
}

function isBlank(value: string | number | null | undefined) {
  return value === null || value === undefined || value === "";
}

function acceptsStaticValue(
  field: Field,
  value: string | number | null,
  target: Manifest,
) {
  return validateInputs({ [field.id]: value }, target, false).length === 0;
}

function sameDefault(left: Field["default"], right: Field["default"]) {
  return Object.is(left, right);
}

function assertUniqueFieldIds(manifest: Manifest) {
  if (
    new Set(manifest.fields.map((field) => field.id)).size !==
    manifest.fields.length
  )
    throw new Error("Model fields must have unique ids before migration.");
}

/**
 * Builds a reviewable new-model input draft. Matching requires a unique
 * semantic identity; normalized ids can disambiguate duplicate semantics only
 * when both manifests retain the same suffix and the semantic identity agrees.
 */
export function planModelUpgrade(
  source: Manifest,
  target: Manifest,
  inputs: InputValues,
): ModelUpgradePlan {
  if (source.id !== target.id)
    throw new Error(
      "A project can only be updated to a version of the same calculator.",
    );
  if (source.version === target.version)
    throw new Error(
      "Choose a different calculator version to update this project.",
    );
  if (!inputs || typeof inputs !== "object" || Array.isArray(inputs))
    throw new Error("Saved project inputs are invalid.");
  assertUniqueFieldIds(source);
  assertUniqueFieldIds(target);
  if (
    Object.keys(inputs).some(
      (id) => !source.fields.some((field) => field.id === id),
    )
  )
    throw new Error(
      "Saved project inputs contain fields outside the source model.",
    );

  const blankInputs = initialInputs(target, "blank");
  const nextInputs = { ...blankInputs };
  const sourceByIdentity = groupFields(source.fields, semanticIdentity);
  const targetByIdentity = groupFields(target.fields, semanticIdentity);
  const matches = new Map<string, Field>();
  const matchedSources = new Set<string>();

  for (const [identity, targetGroup] of targetByIdentity) {
    const sourceGroup = sourceByIdentity.get(identity) ?? [];
    if (sourceGroup.length === 1 && targetGroup.length === 1) {
      matches.set(targetGroup[0].id, sourceGroup[0]);
      matchedSources.add(sourceGroup[0].id);
      continue;
    }

    if (!sourceGroup.length || targetGroup.length < 1) continue;
    const sourceByNormalizedId = groupFields(sourceGroup, (field) =>
      normalizedFieldId(field, source),
    );
    const targetByNormalizedId = groupFields(targetGroup, (field) =>
      normalizedFieldId(field, target),
    );
    for (const [normalizedId, sameIdTargets] of targetByNormalizedId) {
      const sameIdSources = sourceByNormalizedId.get(normalizedId) ?? [];
      if (sameIdSources.length !== 1 || sameIdTargets.length !== 1) continue;
      const oldField = sameIdSources[0];
      const newField = sameIdTargets[0];
      if (matchedSources.has(oldField.id)) continue;
      matches.set(newField.id, oldField);
      matchedSources.add(oldField.id);
    }
  }

  const reviewReasons = new Map<string, string>();
  const defaultChanges: ModelUpgradeDefaultChange[] = [];
  const copied = new Set<string>();

  for (const field of target.fields) {
    const sourceField = matches.get(field.id);
    if (!sourceField) {
      const candidates = sourceByIdentity.get(semanticIdentity(field)) ?? [];
      reviewReasons.set(
        field.id,
        candidates.length > 0
          ? "Several previous fields have the same meaning; review this field manually."
          : "This field is new or changed and has no unambiguous compatible value.",
      );
      continue;
    }

    const hasSavedValue =
      Object.prototype.hasOwnProperty.call(inputs, sourceField.id) &&
      inputs[sourceField.id] !== undefined;
    const currentValue = hasSavedValue ? inputs[sourceField.id] : null;
    if (!hasSavedValue) {
      reviewReasons.set(
        field.id,
        "The previous project has no saved value for this field.",
      );
    } else if (
      acceptsStaticValue(field, currentValue as string | number | null, target)
    ) {
      nextInputs[field.id] = currentValue as string | number | null;
      copied.add(field.id);
    } else {
      reviewReasons.set(
        field.id,
        "The saved value is outside the new model's constraints or options.",
      );
    }

    if (!sameDefault(sourceField.default, field.default)) {
      defaultChanges.push({
        id: field.id,
        label: field.label,
        current: currentValue as string | number | null,
        newDefault: field.default,
      });
    }
  }

  // Dependency and fluid-specific options depend on the final migrated values,
  // so check them after all possible values have been copied. Reverting one
  // field can invalidate another dependent field; the set only shrinks.
  let removedMappedValue = true;
  while (removedMappedValue) {
    removedMappedValue = false;
    for (const field of target.fields) {
      if (!copied.has(field.id)) continue;
      const value = nextInputs[field.id];
      if (
        isBlank(value) ||
        !(field.optionsByDependencyValue || isFluidUnit(target, field))
      )
        continue;
      const options = inputOptions(target, field, nextInputs);
      if (options.includes(String(value))) continue;
      nextInputs[field.id] = blankInputs[field.id];
      copied.delete(field.id);
      reviewReasons.set(
        field.id,
        "The saved value is outside the new model's constraints or options.",
      );
      removedMappedValue = true;
    }
  }

  const reviewFields = target.fields.flatMap((field) => {
    const reason = reviewReasons.get(field.id);
    return reason ? [{ id: field.id, label: field.label, reason }] : [];
  });
  const removedCount = [...sourceByIdentity].reduce(
    (removed, [identity, sourceGroup]) =>
      removed +
      Math.max(
        sourceGroup.length - (targetByIdentity.get(identity)?.length ?? 0),
        0,
      ),
    0,
  );

  return {
    inputs: nextInputs,
    copiedCount: copied.size,
    reviewFields,
    defaultChanges,
    removedCount,
  };
}

/** Appends a visible version marker while respecting the saved-name limit. */
export function updatedCalculationName(
  currentName: string,
  targetVersion: string,
  requestedName?: string,
) {
  const marker = ` (updated to ${targetVersion})`;
  if (marker.length >= 120)
    throw new Error("The target model version is too long for a project name.");
  let base = (requestedName ?? currentName).trim();
  if (!base) base = currentName.trim() || "Calculation";
  const markerSuffix = marker.toLocaleLowerCase("en-US");
  if (base.toLocaleLowerCase("en-US").endsWith(markerSuffix))
    base = base.slice(0, -marker.length).trimEnd();
  const available = 120 - marker.length;
  base =
    base.slice(0, available).trimEnd() || "Calculation".slice(0, available);
  return `${base}${marker}`;
}
