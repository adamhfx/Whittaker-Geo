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
  explanation?: { why: string; steps: string[]; reference?: string };
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
  reason?: "IRR_UNDEFINED",
): CalculationInputDiagnosis {
  const explanation = reason === "IRR_UNDEFINED" ? {
    why: "The model could not calculate an internal rate of return (IRR) for the projected cash flows. This can happen when cash flows do not include both negative investment amounts and positive returns, or when no solution can be found.",
    steps: [
      "Review production, commodity prices, investment costs and operating costs for the intended scenario.",
      "An intentional no-return scenario may have no defined IRR even when the inputs are correct. Keep your draft for model review, or restore the last working inputs.",
    ],
    reference: "https://support.microsoft.com/en-us/excel/functions/irr-function?nochrome=true",
  } : {
    why: "The workbook returned an undefined result, but did not identify its exact mathematical cause.",
    steps: ["Check the changed value and its units against the input’s User Guide.",
      "Restore the last working inputs, then change one value at a time. If the intended scenario still fails, keep the draft for model review."],
  };
  const gasPrice = manifest.id === "state-rent" && manifest.version === "2.0.0-candidate.1"
    ? manifest.fields.find((field) => field.label === "Gas price multiplier") : undefined;
  if (reason === "IRR_UNDEFINED" && gasPrice && failedInputs[gasPrice.id] === 0) {
    explanation.steps.unshift("Gas price multiplier is 0, which removes gas sales revenue. If this was unintended, use 1 for the base price or 0.9 for a 10% reduction; use the value that matches your scenario.");
  }
  if (!workingInputs) return { changes: [], workingInputs: null, explanation };
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
  return { changes, workingInputs: { ...workingInputs }, explanation };
}
