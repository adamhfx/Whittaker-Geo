"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, LoaderCircle } from "lucide-react";
import type { ModelReview } from "./AdminModelReview";

export function ModelMappingEditor({
  review,
  busy,
  onCancel,
  onSave,
}: {
  review: ModelReview;
  busy: boolean;
  onCancel: () => void;
  onSave: (mapping: Record<string, any>) => Promise<void>;
}) {
  const [mapping, setMapping] = useState<Record<string, any>>(() =>
    structuredClone(review.mapping),
  );
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [noteKey, setNoteKey] = useState("");
  const [testCases, setTestCases] = useState(() =>
    JSON.stringify(review.mapping.testCases ?? review.scenarios, null, 2),
  );
  const [customCases, setCustomCases] = useState(!!review.mapping.testCases);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
    dialog.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => {
      dialog.current?.close();
    };
  }, []);
  const edit = (key: string, id: string, value: unknown) =>
    setMapping((previous) => ({
      ...previous,
      [key]: { ...previous[key], [id]: value },
    }));
  const fields: any[] = review.report.fields ?? [];
  const newCells: string[] = review.report.unmappedCells ?? [];
  const fieldNotes = fields.map((field, index) => ({
    id: field.id,
    label:
      field.label + (field.year !== undefined ? ` · Year ${field.year}` : ""),
    note: review.manifest?.fields[index]?.help,
  }));
  const noteItems = [
    ...fieldNotes,
    ...(review.manifest?.groups ?? []).map((group) => ({
      id: group.id,
      label: `${group.name} (section)`,
      note: group.help,
    })),
  ];
  const selectedNote = noteItems.find((item) => item.id === noteKey);
  const note =
    noteKey && Object.hasOwn(mapping.help ?? {}, noteKey)
      ? mapping.help[noteKey]
      : selectedNote?.note;
  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const next = { ...mapping };
      if (customCases) {
        try {
          next.testCases = JSON.parse(testCases);
        } catch {
          throw new Error(
            "The test cases are not valid JSON. Use the example format shown in the editor.",
          );
        }
      } else delete next.testCases;
      await onSave(next);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <dialog
      ref={dialog}
      className="model-map-dialog"
      aria-labelledby="mapping-title"
      onCancel={(event) => {
        if (saving) event.preventDefault();
        else onCancel();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !saving) onCancel();
      }}
    >
      <header>
        <div>
          <p className="admin-kicker">Candidate preparation</p>
          <h2 id="mapping-title">Mapping & notes</h2>
        </div>
        <button
          className="admin-secondary"
          disabled={saving}
          onClick={onCancel}
          type="button"
        >
          <ArrowLeft size={16} /> Return
        </button>
      </header>
      <div className="model-map-content">
        <p>
          Changes create a new private revision and rerun all checks. The active
          calculator stays unchanged.
        </p>
        <button
          className="admin-secondary"
          type="button"
          disabled={saving || busy}
          onClick={() => {
            setMapping((previous) => ({ help: previous.help ?? {} }));
            setCustomCases(false);
            setError("");
          }}
        >
          Reset cell mapping to automatic
        </button>
        <p className="model-review-muted">
          This clears cell overrides, extra input/feedback definitions, and
          custom scenarios in this draft. Published help notes are retained.
          Apply below to rerun the automatic mapping.
        </p>
        {!fields.length && (
          <p className="model-review-notice">
            The workbook could not be analyzed. Check its visible input/OUTPUT
            sheets, remove unsupported external links or formulas, and re-upload
            a corrected workbook. You can also retry the original preparation
            below.
          </p>
        )}
        {!!fields.length && (
          <details open>
            <summary>
              Existing input cells <span>{fields.length} inputs</span>
            </summary>
            <label>
              Find an input
              <input
                type="search"
                placeholder="Search input name or worksheet cell"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <div className="model-review-table-scroll model-map-table">
              <table>
                <thead>
                  <tr>
                    <th>Input</th>
                    <th>Base cell</th>
                    <th>Candidate cell</th>
                    <th>Workbook default</th>
                  </tr>
                </thead>
                <tbody>
                  {fields
                    .filter((field) =>
                      `${field.label} ${field.baseCell} ${field.cell}`
                        .toLowerCase()
                        .includes(query.toLowerCase()),
                    )
                    .map((field) => (
                      <tr key={field.id}>
                        <td>
                          <strong>
                            {field.label}
                            {field.year !== undefined
                              ? ` · Year ${field.year}`
                              : ""}
                          </strong>
                          <small>{field.unit}</small>
                        </td>
                        <td>{field.baseCell}</td>
                        <td>
                          <input
                            aria-label={`Workbook cell for ${field.label}`}
                            list="model-editable-cells"
                            value={
                              mapping.fieldCells?.[field.id] === null
                                ? ""
                                : (mapping.fieldCells?.[field.id] ?? field.cell)
                            }
                            onChange={(event) =>
                              edit(
                                "fieldCells",
                                field.id,
                                event.target.value.toUpperCase(),
                              )
                            }
                          />
                          <label className="model-map-checkbox">
                            <input
                              type="checkbox"
                              checked={mapping.fieldCells?.[field.id] === null}
                              onChange={(event) =>
                                edit(
                                  "fieldCells",
                                  field.id,
                                  event.target.checked ? null : field.cell,
                                )
                              }
                            />{" "}
                            Remove input
                          </label>
                        </td>
                        <td>{String(field.default ?? "Empty")}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <datalist id="model-editable-cells">
              {(review.report.candidateCells ?? []).map((cell: any) => (
                <option key={cell.cell} value={cell.cell}>
                  {String(cell.value ?? "Empty")}
                </option>
              ))}
            </datalist>
          </details>
        )}
        {!!newCells.length && (
          <details open>
            <summary>
              New editable cells <span>{newCells.length} decisions needed</span>
            </summary>
            <p>
              Choose a meaning for each new cell, or explicitly exclude it. A
              new dependency or complex control needs developer review.
            </p>
            {newCells.map((cell) => {
              const definition = (mapping.addedFields ?? []).find(
                (item: any) => item.cell === cell,
              );
              const excluded = (mapping.ignoredCells ?? []).includes(cell);
              const setNew = (changes: any) =>
                setMapping((previous) => ({
                  ...previous,
                  addedFields: [
                    ...(previous.addedFields ?? []).filter(
                      (item: any) => item.cell !== cell,
                    ),
                    {
                      cell,
                      type: "number",
                      label: "",
                      unit: "",
                      ...(previous.addedFields ?? []).find(
                        (item: any) => item.cell === cell,
                      ),
                      ...changes,
                    },
                  ],
                }));
              return (
                <div className="model-map-new" key={cell}>
                  <strong>{cell}</strong>
                  <label>
                    Treatment
                    <select
                      value={excluded ? "exclude" : (definition?.type ?? "")}
                      onChange={(event) => {
                        const choice = event.target.value;
                        setMapping((previous) => ({
                          ...previous,
                          ignoredCells: [
                            ...(previous.ignoredCells ?? []).filter(
                              (value: string) => value !== cell,
                            ),
                            ...(choice === "exclude" ? [cell] : []),
                          ],
                          addedFields: [
                            ...(previous.addedFields ?? []).filter(
                              (item: any) => item.cell !== cell,
                            ),
                            ...(["number", "text", "select"].includes(choice)
                              ? [{ cell, type: choice, label: "", unit: "" }]
                              : []),
                          ],
                        }));
                      }}
                    >
                      <option value="">Choose…</option>
                      <option value="number">Numeric input</option>
                      <option value="text">Text input</option>
                      <option value="select">Dropdown input</option>
                      <option value="exclude">Exclude from app inputs</option>
                    </select>
                  </label>
                  {definition && (
                    <>
                      <label>
                        Input label
                        <input
                          maxLength={200}
                          value={definition.label}
                          onChange={(event) =>
                            setNew({ label: event.target.value })
                          }
                        />
                      </label>
                      <label>
                        Unit
                        <input
                          maxLength={100}
                          value={definition.unit}
                          onChange={(event) =>
                            setNew({ unit: event.target.value })
                          }
                        />
                      </label>
                      {definition.type === "select" && (
                        <label>
                          Exact options, one per line
                          <textarea
                            value={(definition.options ?? []).join("\n")}
                            onChange={(event) =>
                              setNew({
                                options: event.target.value.split("\n"),
                              })
                            }
                          />
                        </label>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </details>
        )}
        {!!fields.length && (
          <details>
            <summary>Input labels, validation & help notes</summary>
            <label>
              Input or section
              <select
                value={noteKey}
                onChange={(event) => setNoteKey(event.target.value)}
              >
                <option value="">Choose an input or section…</option>
                {noteItems.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            {selectedNote && (
              <>
                {fields
                  .filter((field) => field.id === noteKey)
                  .map((field) => {
                    const meta = {
                      ...field,
                      ...mapping.fieldMetadata?.[field.id],
                    };
                    const setMeta = (key: string, value: unknown) =>
                      edit("fieldMetadata", field.id, {
                        ...mapping.fieldMetadata?.[field.id],
                        [key]: value,
                      });
                    return (
                      <div className="model-map-metadata" key={field.id}>
                        <label>
                          Input label
                          <input
                            maxLength={200}
                            value={meta.label}
                            onChange={(event) =>
                              setMeta("label", event.target.value)
                            }
                          />
                        </label>
                        <label>
                          Unit
                          <input
                            maxLength={100}
                            value={meta.unit}
                            onChange={(event) =>
                              setMeta("unit", event.target.value)
                            }
                          />
                        </label>
                        {field.type === "number" && (
                          <>
                            {[
                              ["min", "Minimum"],
                              ["max", "Maximum"],
                              ["exclusiveMin", "Greater than"],
                              ["exclusiveMax", "Less than"],
                            ].map(([key, title]) => (
                              <label key={key}>
                                {title}
                                <input
                                  type="number"
                                  step="any"
                                  value={meta[key] ?? ""}
                                  onChange={(event) =>
                                    setMeta(
                                      key,
                                      event.target.value === ""
                                        ? null
                                        : Number(event.target.value),
                                    )
                                  }
                                />
                              </label>
                            ))}
                            <label className="model-map-checkbox">
                              <input
                                type="checkbox"
                                checked={!!meta.integer}
                                onChange={(event) =>
                                  setMeta("integer", event.target.checked)
                                }
                              />{" "}
                              Whole numbers only
                            </label>
                          </>
                        )}
                        <label className="model-map-checkbox">
                          <input
                            type="checkbox"
                            checked={!!meta.required}
                            onChange={(event) =>
                              setMeta("required", event.target.checked)
                            }
                          />{" "}
                          Required input
                        </label>
                      </div>
                    );
                  })}
                <label>
                  Help title
                  <input
                    maxLength={200}
                    value={note?.title ?? selectedNote.label}
                    onChange={(event) =>
                      edit("help", noteKey, {
                        title: event.target.value,
                        body: note?.body ?? "",
                      })
                    }
                  />
                </label>
                <label>
                  Published help note
                  <textarea
                    maxLength={12000}
                    value={note?.body ?? ""}
                    onChange={(event) =>
                      edit("help", noteKey, {
                        title: note?.title ?? selectedNote.label,
                        body: event.target.value,
                      })
                    }
                    placeholder="Specific guidance for this input; leave absent if the guide only covers its section."
                  />
                </label>
                <button
                  className="admin-secondary"
                  type="button"
                  onClick={() => edit("help", noteKey, null)}
                >
                  Remove this help note
                </button>
              </>
            )}
          </details>
        )}
        {!!review.report.outputViews?.length && (
          <details>
            <summary>Published output ranges</summary>
            <p>
              Choose the compact area from each existing OUTPUT sheet. Exports
              start these ranges at column A.
            </p>
            {review.report.outputViews.map((view: any) => (
              <label key={view.id}>
                {view.sheet}
                <input
                  value={mapping.outputRanges?.[view.id] ?? view.range}
                  placeholder="C2:AT60"
                  onChange={(event) =>
                    edit(
                      "outputRanges",
                      view.id,
                      event.target.value.toUpperCase(),
                    )
                  }
                />
              </label>
            ))}
          </details>
        )}
        {!!review.report.summaryCells?.length && (
          <details>
            <summary>Dashboard summary values</summary>
            <div className="model-map-grid">
              {review.report.summaryCells.map((item: any) => (
                <label key={item.index}>
                  {item.label}
                  <small>{item.sheet}</small>
                  <input
                    value={
                      mapping.summaryCells?.[String(item.index)]?.cell ??
                      item.cell
                    }
                    onChange={(event) =>
                      edit("summaryCells", String(item.index), {
                        ...mapping.summaryCells?.[String(item.index)],
                        cell: event.target.value.toUpperCase(),
                      })
                    }
                  />
                </label>
              ))}
            </div>
          </details>
        )}
        {!!review.report.feedbackCells?.length && (
          <details>
            <summary>Interim feedback cells</summary>
            <div className="model-map-grid">
              {review.report.feedbackCells.map((item: any) => (
                <label key={item.id}>
                  {item.label}
                  <input
                    value={mapping.feedbackCells?.[item.id] ?? item.cell}
                    onChange={(event) =>
                      edit(
                        "feedbackCells",
                        item.id,
                        event.target.value.toUpperCase(),
                      )
                    }
                  />
                </label>
              ))}
            </div>
            <p className="model-review-muted">
              Additional feedback definitions can be added below. Existing
              feedback remains mapped to its input section.
            </p>
            <AdditionalFeedback
              mapping={mapping}
              setMapping={setMapping}
              review={review}
            />
          </details>
        )}
        {!!review.report.guideChanges?.length && (
          <details open>
            <summary>Changed User Guide content</summary>
            {review.report.guideChanges.map((change: any) => (
              <article className="model-map-guide" key={change.cell}>
                <strong>{change.cell}</strong>
                <div>
                  <p>
                    <small>Previous</small>
                    {change.before || "Empty"}
                  </p>
                  <p>
                    <small>Candidate</small>
                    {change.after || "Empty"}
                  </p>
                </div>
              </article>
            ))}
            <label className="model-map-checkbox">
              <input
                type="checkbox"
                checked={!!mapping.guideReviewed}
                onChange={(event) =>
                  setMapping((previous) => ({
                    ...previous,
                    guideReviewed: event.target.checked,
                  }))
                }
              />{" "}
              I reviewed the changed guide and updated the relevant
              input/section notes above.
            </label>
          </details>
        )}
        <details>
          <summary>
            Validation scenarios <span>Advanced</span>
          </summary>
          <p>
            Default checks use model multipliers and supported alternatives.
            Custom cases use exact UI cell addresses and scalar values; they
            test runtime behavior rather than independent Excel parity.
          </p>
          <label className="model-map-checkbox">
            <input
              type="checkbox"
              checked={customCases}
              onChange={(event) => setCustomCases(event.target.checked)}
            />{" "}
            Use custom scenarios (1–8)
          </label>
          {customCases && (
            <label>
              Scenario definitions
              <textarea
                className="model-map-code"
                value={testCases}
                onChange={(event) => setTestCases(event.target.value)}
                placeholder={
                  '[{"name":"Price sensitivity","changes":{"H61":0.9}}]'
                }
              />
            </label>
          )}
        </details>
        {error && (
          <p className="admin-inline-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <footer>
        <p>
          Applying creates revision {review.revision + 1} and invalidates the
          earlier validation report.
        </p>
        <button
          className="admin-primary"
          disabled={saving || busy}
          onClick={() => void save()}
          type="button"
        >
          {saving ? (
            <>
              <LoaderCircle className="admin-spin" size={16} /> Saving…
            </>
          ) : (
            "Apply mapping & run checks"
          )}
        </button>
      </footer>
    </dialog>
  );
}

function AdditionalFeedback({
  mapping,
  setMapping,
  review,
}: {
  mapping: Record<string, any>;
  setMapping: (update: any) => void;
  review: ModelReview;
}) {
  const entries: any[] = mapping.addedFeedback ?? [];
  const edit = (index: number, key: string, value: string) =>
    setMapping((previous: any) => ({
      ...previous,
      addedFeedback: (previous.addedFeedback ?? []).map(
        (item: any, i: number) =>
          i === index ? { ...item, [key]: value } : item,
      ),
    }));
  return (
    <>
      {entries.map((item, index) => (
        <div className="model-map-grid" key={index}>
          <label>
            Cell
            <input
              value={item.cell}
              onChange={(event) =>
                edit(index, "cell", event.target.value.toUpperCase())
              }
            />
          </label>
          <label>
            Label
            <input
              maxLength={160}
              value={item.label}
              onChange={(event) => edit(index, "label", event.target.value)}
            />
          </label>
          <label>
            Unit
            <input
              maxLength={100}
              value={item.unit}
              onChange={(event) => edit(index, "unit", event.target.value)}
            />
          </label>
          <label>
            Section
            <select
              value={item.group}
              onChange={(event) => edit(index, "group", event.target.value)}
            >
              <option value="">Choose…</option>
              {review.manifest?.groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
          </label>
          <button
            className="admin-secondary"
            type="button"
            onClick={() =>
              setMapping((previous: any) => ({
                ...previous,
                addedFeedback: previous.addedFeedback.filter(
                  (_: any, i: number) => i !== index,
                ),
              }))
            }
          >
            Remove
          </button>
        </div>
      ))}
      <button
        className="admin-secondary"
        type="button"
        onClick={() =>
          setMapping((previous: any) => ({
            ...previous,
            addedFeedback: [
              ...(previous.addedFeedback ?? []),
              { cell: "", label: "", unit: "", group: "" },
            ],
          }))
        }
      >
        Add interim feedback
      </button>
    </>
  );
}
