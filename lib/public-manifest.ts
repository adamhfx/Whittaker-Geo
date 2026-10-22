import type { HelpNote, Manifest } from "./types";

function help(note: HelpNote | undefined) {
  return note && typeof note.title === "string" && typeof note.body === "string"
    ? { title: note.title, body: note.body } : undefined;
}

// Source workbooks, formulas, runtime mappings and review records stay private.
export function publicManifest(manifest: Manifest) {
  const fields = manifest.fields.map((field) => {
    const { id, label, unit, group, type, default: defaultValue, required,
      blankOnNew, options, year, scheduleRow, min, max, exclusiveMin, exclusiveMax, integer, role, dependsOn, optionsByDependencyValue, optionLabels, radioGroup } = field;
    const note = help(field.help);
    return { id, label, unit, group, type, default: defaultValue, required, blankOnNew,
      ...(options ? { options } : {}), ...(year !== undefined ? { year } : {}),
      ...(scheduleRow !== undefined ? { scheduleRow } : {}),
      ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}),
      ...(exclusiveMin !== undefined ? { exclusiveMin } : {}),
      ...(exclusiveMax !== undefined ? { exclusiveMax } : {}),
      ...(integer !== undefined ? { integer } : {}), ...(note ? { help: note } : {}),
      ...(role ? { role } : {}), ...(dependsOn ? { dependsOn } : {}),
      ...(optionsByDependencyValue ? { optionsByDependencyValue: Object.fromEntries(Object.entries(optionsByDependencyValue).map(([key, values]) => [key, values.filter((v) => typeof v === "string")])) } : {}),
      ...(optionLabels ? { optionLabels: Object.fromEntries(Object.entries(optionLabels).filter(([,value]) => typeof value === "string")) } : {}),
      ...(radioGroup ? { radioGroup } : {}) };
  });
  const outputViews = !Array.isArray(manifest.outputs) && manifest.outputs?.views
    ? manifest.outputs.views.map(({ id, label, sheet }) => ({ id, name: label, sheet }))
    : manifest.outputViews?.map(({ id, name, sheet }) => ({ id, name, sheet }));
  return { id: manifest.id, version: manifest.version, name: manifest.name,
    description: manifest.description, releaseStatus: manifest.releaseStatus,
    groups: manifest.groups.map(({ id, name, help: note }) => ({ id, name,
      ...(help(note) ? { help: help(note) } : {}) })), fields,
    ...(outputViews ? { outputViews } : {}),
    ...(manifest.inputRules?.ascending ? { inputRules: { ascending: manifest.inputRules.ascending.map(({label, fields}) => ({label, fields})) } } : {}) };
}
