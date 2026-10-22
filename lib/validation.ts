import type { InputValues, Manifest } from "./types";
import { inputOptions, isFluidUnit } from "./input-options";

export function validateInputs(
  values: InputValues,
  manifest: Manifest,
  complete = false,
): string[] {
  const errors: string[] = [];
  const keys = new Set(manifest.fields.map((f) => f.id));
  if (Object.keys(values).some((k) => !keys.has(k)))
    errors.push("Unknown input field.");
  for (const f of manifest.fields) {
    const v = values[f.id];
    if (complete && isFluidUnit(manifest, f) && v && !inputOptions(manifest, f, values).includes(String(v)))
      errors.push(`${f.label} must match the primary reservoir fluid.`);
    if (v === null || v === undefined || v === "") {
      if (complete && f.required) errors.push(`${f.label} is required.`);
      continue;
    }
    if (f.type === "number") {
      if (typeof v !== "number" || !Number.isFinite(v)) {
        errors.push(`${f.label} must be a number.`);
        continue;
      }
      if (
        (f.min !== undefined && v < f.min) ||
        (f.max !== undefined && v > f.max) ||
        (f.exclusiveMin !== undefined && v <= f.exclusiveMin) ||
        (f.exclusiveMax !== undefined && v >= f.exclusiveMax)
      )
        errors.push(`${f.label} is outside its allowed range.`);
      if (f.integer && !Number.isInteger(v))
        errors.push(`${f.label} must be a whole number.`);
    } else if (f.type === "select" && !f.options?.includes(String(v)))
      errors.push(`${f.label} has an invalid selection.`);
    else if (f.type === "milestone" && v !== "X")
      errors.push("Invalid facilities milestone.");
    else if (typeof v !== "string" || v.length > 200)
      errors.push(`${f.label} must contain at most 200 characters.`);
  }
  if (
    complete &&
    manifest.fields.some((f) => f.type === "milestone") &&
    manifest.fields.filter(
      (f) => f.type === "milestone" && values[f.id] === "X",
    ).length !== 1
  )
    errors.push("Choose exactly one facilities completion year.");

  if (complete) {
    for (const rule of manifest.inputRules?.ascending ?? []) {
      if (!rule.fields.length || rule.fields.some((id) => !keys.has(id))) continue;
      const ruleValues = rule.fields.map((id) => values[id]);
      // Partial optional input should remain usable; compare a tier only when every
      // member is present and numeric. Per-field required/type checks report blanks.
      if (ruleValues.some((value) => value === null || value === undefined || value === "")) continue;
      if (ruleValues.some((value) => typeof value !== "number" || !Number.isFinite(value))) continue;
      if (ruleValues.some((value, index) => index > 0 && Number(value) <= Number(ruleValues[index - 1])))
        errors.push(`${rule.label} values must be strictly increasing.`);
    }
  }
  return errors;
}
export function initialInputs(
  manifest: Manifest,
  mode: "example" | "blank",
): InputValues {
  return Object.fromEntries(
    manifest.fields.map((f) => [
      f.id,
      mode === "blank" && f.blankOnNew
        ? f.group === "schedule"
          ? f.type === "milestone"
            ? ""
            : 0
          : null
        : f.default,
    ]),
  );
}
export function paidAccess(
  s: { status: string; paid_until: string | null } | null,
  now = Date.now(),
): boolean {
  return (
    !!s &&
    ["active", "past_due"].includes(s.status) &&
    !!s.paid_until &&
    Date.parse(s.paid_until) > now
  );
}
