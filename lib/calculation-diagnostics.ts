import type { Field, InputValues, Manifest } from "./types";
import { optionLabel } from "./input-options";

export type ChangedCalculationInput = {
  id: string;
  label: string;
  section: string;
  previous: string;
  current: string;
};
export type CalculationInputDiagnosis = {
  changes: ChangedCalculationInput[];
  workingInputs: InputValues | null;
};

function displayInput(field: Field, value: InputValues[string] | undefined) {
  if (value === null || value === undefined || value === "") return "Not set";
  if (typeof value === "number") return String(value);
  return field.optionLabels?.[value] || optionLabel(value);
}

/** A comparison with a verified successful snapshot, not a formula-dependency guess. */
export function diagnoseCalculationInputs(
  manifest: Manifest,
  workingInputs: InputValues | null,
  failedInputs: InputValues,
): CalculationInputDiagnosis {
  if (!workingInputs) return { changes: [], workingInputs: null };
  const changes = manifest.fields.flatMap((field) => {
    const previous = workingInputs[field.id] === "" ? null : workingInputs[field.id] ?? null;
    const current = failedInputs[field.id] === "" ? null : failedInputs[field.id] ?? null;
    if (previous === current) return [];
    return [{
      id: field.id,
      label: field.label + (field.year === undefined ? "" : ` · Year ${field.year}`),
      section: manifest.groups.find((group) => group.id === field.group)?.name || "Inputs",
      previous: displayInput(field, previous),
      current: displayInput(field, current),
    }];
  });
  return { changes, workingInputs: { ...workingInputs } };
}
