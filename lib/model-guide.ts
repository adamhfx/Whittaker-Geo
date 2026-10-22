import guide from "./model-guide.json";
import type { HelpNote } from "./types";

// Display-only correction to the released model. Numerical manifests and
// workbook hashes remain immutable. Null means the guide has section advice
// rather than a note about that individual field.
export function modelGuide(id: string, version: string, kind: "fields" | "groups", key: string, fallback?: HelpNote): HelpNote | undefined {
  if (id !== guide.calculatorId || version !== guide.version) return fallback;
  const notes = guide[kind] as Record<string, HelpNote | null>;
  if (!Object.hasOwn(notes, key)) return fallback;
  return notes[key] ?? undefined;
}
