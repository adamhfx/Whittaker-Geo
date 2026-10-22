import type { Field, InputValues, Manifest } from "./types";

const optionLabels: Record<string, string> = {
  oil: "Oil",
  Oil: "Oil",
  NG: "Natural gas",
  "barrels(oil)": "Barrels (Oil)",
  "tonnes(oil)": "Tonnes (Oil)",
  "scf(gas)": "scf (Gas)",
  "m3(gas)": "m³ (Gas)",
  X: "Completed",
};

// Display labels never change the workbook's stored option values.
export function optionLabel(value: string) {
  return optionLabels[value] ?? value;
}

function hasDependencyOptions(field: Field) {
  return !!field.dependsOn && !!field.optionsByDependencyValue;
}

export function isFluidUnit(manifest: Manifest, field: Field) {
  if (
    field.role === "inPlaceVolumeUnit" ||
    field.role === "initialRateUnit" ||
    field.role === "initialFlowRateUnit" ||
    hasDependencyOptions(field)
  )
    return true;

  // Legacy state-rent manifests used plain cell addresses and C5/C6/C7.
  return manifest.id === "state-rent" && ["C6", "C7"].includes(field.id);
}

export function inputOptions(manifest: Manifest, field: Field, inputs: InputValues) {
  const options = field.options ?? [];

  if (hasDependencyOptions(field)) {
    const dependencyValue = inputs[field.dependsOn!];
    if (dependencyValue === null || dependencyValue === undefined || dependencyValue === "") return [];
    const dependentOptions = field.optionsByDependencyValue![String(dependencyValue)] ?? [];
    // Intersect with declared options so a bad dependency map cannot introduce values.
    return dependentOptions.filter((option) => options.includes(option));
  }

  if (!isFluidUnit(manifest, field)) return options;
  const suffix = inputs.C5 === "oil" ? "(oil)" : inputs.C5 === "NG" ? "(gas)" : null;
  return suffix ? options.filter((option) => option.endsWith(suffix)) : [];
}

function isPrimaryFluid(manifest: Manifest, field: Field | undefined, id: string) {
  if (field?.role === "primaryFluid") return true;
  return manifest.id === "state-rent" && id === "C5";
}

function clearInvalidDependentOptions(
  manifest: Manifest,
  fields: Field[],
  next: InputValues,
) {
  for (const field of fields.filter((candidate) => isFluidUnit(manifest, candidate))) {
    const value = next[field.id];
    if (
      value !== null && value !== undefined && value !== "" &&
      !inputOptions(manifest, field, next).includes(String(value))
    )
      next[field.id] = null;
  }
}

function selectMilestone(
  fields: Field[],
  selectedField: Field,
  next: InputValues,
) {
  if (next[selectedField.id] !== "X") return;
  const group = selectedField.radioGroup;
  for (const field of fields) {
    if (field.id === selectedField.id || field.type !== "milestone") continue;
    if (group ? field.radioGroup === group : true) next[field.id] = "";
  }
}

export function changeInput(
  manifest: Manifest | null,
  inputs: InputValues,
  id: string,
  value: string | number | null,
) {
  const next = { ...inputs, [id]: value };
  if (!manifest) return next;

  const field = manifest.fields.find((candidate) => candidate.id === id);
  if (isPrimaryFluid(manifest, field, id))
    clearInvalidDependentOptions(manifest, manifest.fields, next);
  if (field?.type === "milestone") selectMilestone(manifest.fields, field, next);
  return next;
}
