"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  LoaderCircle,
  Pause,
  Play,
  RefreshCw,
  ShieldCheck,
  AlertCircle,
} from "lucide-react";
import { WorkbookOutputs } from "./LiveCalculation";
import { OutputPresentation } from "./OutputPresentation";
import { initialInputs, validateInputs } from "@/lib/validation";
import { changeInput, inputOptions } from "@/lib/input-options";
import type { InputValues, LiveResult, Manifest } from "@/lib/types";
import { ModelMappingEditor } from "./ModelMappingEditor";
import "./admin-model-review.css";

export type ModelReview = {
  id: string;
  fileName: string;
  calculatorId: string;
  calculatorName: string;
  sourceStatus: string;
  baseVersion: string;
  currentVersion: string;
  sourceSha256: string;
  revision: number;
  state: string;
  phase: string;
  candidateVersion: string | null;
  mapping: Record<string, any>;
  report: Record<string, any>;
  manifest: Manifest | null;
  baseline: LiveResult | null;
  checks: Record<string, any>;
  scenarios: { name: string; changes: Record<string, any> }[];
  scenarioIndex: number;
  reviewHash: string | null;
  error: string | null;
  leaseUntil: string | null;
  hasExport: boolean;
  approvedAt: string | null;
  approvalNotes: string | null;
};

async function responseBody(response: Response) {
  let value;
  try {
    value = await response.json();
  } catch {
    throw new Error(
      "The service could not respond. Your preparation progress is saved; please retry.",
    );
  }
  if (!response.ok)
    throw new Error(
      typeof value.error === "string"
        ? value.error
        : "This request could not finish. Please retry.",
    );
  return value;
}
const pending = (review: ModelReview) =>
  ["queued", "working", "validating"].includes(review.state) &&
  review.sourceStatus === "review_required";
const labels: Record<string, string> = {
  queued: "Ready to prepare",
  working: "Preparing workbook",
  validating: "Checking calculations",
  mapping_required: "Mapping review needed",
  ready: "Ready for your review",
  failed: "Checks need attention",
  approved: "Approved release",
};

export function AdminModelReview({
  id,
  autoStart = false,
  onBack,
  onApproved,
  initialReview,
}: {
  id: string;
  autoStart?: boolean;
  onBack: () => void;
  onApproved: () => void;
  initialReview?: ModelReview;
}) {
  const [review, setReview] = useState<ModelReview | null>(
    initialReview ?? null,
  );
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [waiting, setWaiting] = useState(false);
  const [tab, setTab] = useState("checks");
  const [mappingOpen, setMappingOpen] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [notes, setNotes] = useState("");
  const [approving, setApproving] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const retries = useRef(0);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const url = `/api/admin/model-uploads/${encodeURIComponent(id)}`;
  const load = useCallback(async () => {
    const body = await responseBody(await fetch(url, { cache: "no-store" }));
    setReview(body.review);
    return body.review as ModelReview;
  }, [url]);
  useEffect(() => {
    if (initialReview) return;
    let alive = true;
    load()
      .then((value) => {
        if (alive && autoStart && pending(value)) setRunning(true);
      })
      .catch((caught) => {
        if (alive) setError(caught.message);
      });
    return () => {
      alive = false;
    };
  }, [load, autoStart, initialReview]);
  useEffect(() => {
    setAcknowledged(false);
  }, [review?.revision, review?.reviewHash]);
  useEffect(() => {
    if (!running || !review || !pending(review) || inFlight.current) return;
    const timer = window.setTimeout(
      async () => {
        inFlight.current = true;
        setBusy(true);
        setError("");
        try {
          const body = await responseBody(
            await fetch(url, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "process" }),
            }),
          );
          if (!mounted.current) return;
          setWaiting(!!body.retry);
          setReview(body.review);
          retries.current = body.retry ? retries.current + 1 : 0;
          if (retries.current >= 12) {
            setRunning(false);
            setError(
              "The free engine is still unavailable. Progress is saved. Resume preparation when the service is available.",
            );
          }
          if (!pending(body.review)) setRunning(false);
        } catch (caught) {
          if (mounted.current) {
            setError((caught as Error).message);
            setRunning(false);
          }
        } finally {
          inFlight.current = false;
          if (mounted.current) setBusy(false);
        }
      },
      waiting ? 12_000 : review.leaseUntil ? 4_000 : 250,
    );
    return () => {
      window.clearTimeout(timer);
    };
  }, [running, review, url, waiting]);

  const download = async () => {
    setDownloading(true);
    setError("");
    try {
      const body = await responseBody(
        await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "export" }),
        }),
      );
      window.location.assign(body.url);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setDownloading(false);
    }
  };
  const approve = async () => {
    if (!review?.reviewHash || !acknowledged) return;
    setApproving(true);
    setError("");
    try {
      const body = await responseBody(
        await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "approve",
            revision: review.revision,
            reviewHash: review.reviewHash,
            expectedBase: review.baseVersion,
            acknowledged: true,
            notes,
          }),
        }),
      );
      setReview(body.review);
      onApproved();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setApproving(false);
    }
  };
  if (!review)
    return (
      <section className="admin-card model-review">
        <button className="admin-back" onClick={onBack}>
          <ArrowLeft size={16} /> Workbook uploads
        </button>
        {error ? (
          <p role="alert">
            {error}{" "}
            <button
              onClick={() =>
                void load().catch((caught) => setError(caught.message))
              }
            >
              Retry
            </button>
          </p>
        ) : (
          <p role="status">Loading model review…</p>
        )}
      </section>
    );
  const checks = review.checks;
  const steps = [
    {
      title: "Prepare",
      complete: !!checks.preparation?.passed,
      description: "Map inputs and create a private runtime",
    },
    {
      title: "Compare",
      complete: !!checks.baseline?.passed,
      description: "Check the saved Excel baseline",
    },
    {
      title: "Exercise",
      complete:
        review.scenarios.length > 0 &&
        review.scenarioIndex === review.scenarios.length,
      description: `${review.scenarioIndex} of ${review.scenarios.length} scenarios completed`,
    },
    {
      title: "Verify export",
      complete: !!checks.export?.passed,
      description: "Reset inputs and check the Excel tabs",
    },
  ];
  const activeIndex = steps.findIndex((step) => !step.complete);
  return (
    <section className="model-review" aria-label="Model preparation review">
      <button className="admin-back" onClick={onBack} type="button">
        <ArrowLeft size={16} /> Workbook uploads
      </button>
      <header className="model-review-heading">
        <div>
          <p className="admin-kicker">
            Private candidate · Revision {review.revision}
          </p>
          <h2>{review.fileName}</h2>
          <p>
            {review.calculatorName} · Based on {review.baseVersion}
          </p>
        </div>
        <span className={`model-review-status is-${review.state}`}>
          {labels[review.state] ?? review.state}
        </span>
      </header>
      <ol className="model-review-steps">
        {steps.map((step, index) => (
          <li
            key={step.title}
            className={
              step.complete
                ? "is-complete"
                : index === activeIndex && running
                  ? "is-working"
                  : ""
            }
          >
            <span>
              {step.complete ? <CheckCircle2 size={19} /> : index + 1}
            </span>
            <div>
              <strong>{step.title}</strong>
              <small>{step.description}</small>
            </div>
          </li>
        ))}
      </ol>
      {error && (
        <div className="admin-alert admin-alert-error" role="alert">
          <AlertCircle size={18} />
          {error}
        </div>
      )}
      {review.error && (
        <div className="model-review-notice is-error" role="alert">
          <strong>Preparation stopped</strong>
          <p>{review.error}</p>
        </div>
      )}
      {review.state === "mapping_required" && (
        <div className="model-review-notice">
          <strong>Review the workbook mapping before checks continue</strong>
          <ul>
            {(review.report.issues ?? []).map((issue: string) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
          <button
            className="admin-primary"
            onClick={() => setMappingOpen(true)}
            type="button"
          >
            Review mapping
          </button>
        </div>
      )}
      {pending(review) && (
        <div className="model-review-progress" role="status">
          <div>
            {running ? (
              <LoaderCircle className="admin-spin" size={23} />
            ) : (
              <Pause size={22} />
            )}
            <p>
              <strong>
                {running
                  ? waiting
                    ? "Waiting for the free calculation engine"
                    : review.phase === "scenario"
                      ? `Testing: ${review.scenarios[review.scenarioIndex]?.name ?? "input changes"}`
                      : steps[Math.max(0, activeIndex)]?.description
                  : "Preparation is paused"}
              </strong>
              <span>
                The first check can take a few minutes while the free service
                starts. Keep this page open to continue; saved progress resumes
                when you return.
              </span>
            </p>
          </div>
          <button
            className="admin-secondary"
            onClick={() => {
              setRunning(!running);
              retries.current = 0;
            }}
            type="button"
          >
            {running ? (
              <>
                <Pause size={15} /> Pause after this step
              </>
            ) : (
              <>
                <Play size={15} /> Resume preparation
              </>
            )}
          </button>
        </div>
      )}
      {review.state === "approved" && (
        <div className="model-review-notice is-success">
          <ShieldCheck size={22} />
          <div>
            <strong>This version was approved and released</strong>
            <p>
              {review.approvedAt
                ? new Date(review.approvedAt).toLocaleString()
                : ""}
              {review.approvalNotes ? ` · ${review.approvalNotes}` : ""}.
              Earlier projects and saved runs retain their original model.
            </p>
          </div>
        </div>
      )}
      <div className="model-review-toolbar">
        <nav aria-label="Model review sections">
          {[
            ["checks", "Validation"],
            ["results", "Results & trials"],
            [
              "changes",
              `Input changes (${review.report.changes?.length ?? 0})`,
            ],
            ["release", "Release"],
          ].map(([key, label]) => (
            <button
              type="button"
              key={key}
              aria-current={tab === key ? "page" : undefined}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </nav>
        <div>
          <button
            className="admin-secondary"
            disabled={busy}
            onClick={() =>
              void load().catch((caught) => setError(caught.message))
            }
            type="button"
            aria-label="Reload this model review"
          >
            <RefreshCw size={15} />
          </button>
          {review.hasExport && (
            <button
              className="admin-secondary"
              disabled={downloading}
              onClick={() => void download()}
              type="button"
            >
              <Download size={15} />
              {downloading ? "Preparing…" : "Excel export"}
            </button>
          )}
        </div>
      </div>
      {tab === "checks" && (
        <div className="admin-card model-review-panel">
          <h3>Validation report</h3>
          <p className="model-review-muted">
            The active model stays in use until you approve this exact
            candidate.
          </p>
          <div className="model-review-stats">
            <article>
              <strong>{review.report.inputCount ?? "—"}</strong>
              <span>Mapped inputs</span>
            </article>
            <article>
              <strong>{review.report.chartCount ?? "—"}</strong>
              <span>Published charts</span>
            </article>
            <article>
              <strong>
                {checks.baseline?.numericValues?.toLocaleString() ?? "—"}
              </strong>
              <span>Numbers compared</span>
            </article>
            <article>
              <strong>
                {checks.preparation?.compatibilityRewrites ?? "—"}
              </strong>
              <span>Compatibility adjustments</span>
            </article>
          </div>
          <ul className="model-review-checks">
            {[
              [
                "Private runtime prepared",
                checks.preparation,
                "Original workbook preserved; source and runtime checksums recorded.",
              ],
              [
                "Saved Excel baseline",
                checks.baseline,
                checks.baseline
                  ? `${checks.baseline.cachedFormulaCells ?? 0} cached formula cells checked against recalculated results.`
                  : "Waiting for the baseline comparison.",
              ],
              [
                "Reset after input changes",
                checks.reset,
                "Verify that trial changes do not contaminate the next calculation.",
              ],
              [
                "Excel export",
                checks.export,
                checks.export
                  ? `${checks.export.tabs} tabs and ${checks.export.charts} charts; borders and column origins checked.`
                  : "Waiting for output workbook checks.",
              ],
            ].map(([title, check, description]) => (
              <li
                key={String(title)}
                className={check?.passed === false ? "is-error" : ""}
              >
                <span>
                  {check?.passed ? (
                    <CheckCircle2 size={19} />
                  ) : check?.passed === false ? (
                    <AlertCircle size={19} />
                  ) : (
                    "○"
                  )}
                </span>
                <div>
                  <strong>{title}</strong>
                  <p>{description}</p>
                </div>
                <small>
                  {check ? (check.passed ? "Passed" : "Failed") : "Pending"}
                </small>
              </li>
            ))}
          </ul>
          {!!checks.baseline?.differences?.length && (
            <details open>
              <summary>Baseline differences</summary>
              <div className="model-review-table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Result location</th>
                      <th>Recalculated</th>
                      <th>Saved Excel</th>
                    </tr>
                  </thead>
                  <tbody>
                    {checks.baseline.differences.map(
                      (difference: any, index: number) => (
                        <tr key={index}>
                          <td>
                            {difference.location}
                            {difference.reason ? ` · ${difference.reason}` : ""}
                          </td>
                          <td>{String(difference.actual ?? "Empty")}</td>
                          <td>{String(difference.expected ?? "Empty")}</td>
                        </tr>
                      ),
                    )}
                  </tbody>
                </table>
              </div>
            </details>
          )}
          <h4>Representative scenarios</h4>
          <p className="model-review-muted">
            These check runtime behavior. They are not independent Excel parity
            tests for changed inputs.
          </p>
          {review.scenarios.map((scenario, index) => {
            const result = checks.scenarios?.[index];
            return (
              <details className="model-review-scenario" key={index}>
                <summary>
                  <span>
                    {result?.passed ? "✓" : "○"} {scenario.name}
                  </span>
                  <small>
                    {result
                      ? `${Number(result.durationSeconds).toFixed(1)} seconds`
                      : "Pending"}
                  </small>
                </summary>
                <p>
                  {Object.entries(scenario.changes)
                    .map(([cell, value]) => `${cell}: ${value}`)
                    .join(" · ")}
                </p>
                {result && (
                  <OutputPresentation
                    summary={result.summary}
                    charts={result.charts}
                  />
                )}
              </details>
            );
          })}
          <div className="model-review-notice">
            <strong>What still needs your judgement</strong>
            <p>
              Baseline parity uses the values saved in the uploaded Excel file.
              Fresh Excel recalculation parity for changed-input scenarios
              remains unverified. Review the financial results and any changed
              assumptions before releasing the candidate.
            </p>
          </div>
          <details className="model-review-provenance">
            <summary>Workbook identity</summary>
            <dl>
              <dt>Candidate</dt>
              <dd>{review.candidateVersion ?? "Not prepared"}</dd>
              <dt>Source SHA-256</dt>
              <dd>{review.sourceSha256}</dd>
              <dt>Runtime SHA-256</dt>
              <dd>{checks.preparation?.runtimeSha256 ?? "Not prepared"}</dd>
            </dl>
          </details>
        </div>
      )}
      {tab === "results" && (
        <CandidateTrials
          key={review.candidateVersion}
          review={review}
          url={url}
        />
      )}
      {tab === "changes" && (
        <div className="admin-card model-review-panel">
          <div className="model-review-row">
            <div>
              <h3>Changes from the active base</h3>
              <p className="model-review-muted">
                Check the workbook defaults, moved inputs, and published ranges.
              </p>
            </div>
            <button
              className="admin-secondary"
              disabled={busy || review.state === "approved"}
              onClick={() => {
                setRunning(false);
                setMappingOpen(true);
              }}
              type="button"
            >
              Edit mapping & notes
            </button>
          </div>
          {review.report.changes?.length ? (
            <div className="model-review-table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Input</th>
                    <th>Change</th>
                    <th>Previous</th>
                    <th>Candidate</th>
                  </tr>
                </thead>
                <tbody>
                  {review.report.changes.map((change: any, index: number) => (
                    <tr key={index}>
                      <td>{change.label}</td>
                      <td>{String(change.kind).replaceAll("_", " ")}</td>
                      <td>{String(change.before ?? "—")}</td>
                      <td>{String(change.after ?? "—")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p>No default-value or input-position changes were detected.</p>
          )}
          <p className="model-review-muted">
            Formula changes are validated through the calculated baseline and
            representative scenarios. They are not inferred from this
            input-change list.
          </p>
          {(review.report.guideChanges?.length ?? 0) > 0 && (
            <p>
              {review.report.guideChanges.length} User Guide cells changed.
              Review them in Mapping & notes.
            </p>
          )}
        </div>
      )}
      {tab === "release" && (
        <div className="admin-card model-review-panel model-review-release">
          <ShieldCheck size={30} />
          <h3>
            {review.state === "approved"
              ? "Release recorded"
              : "Approve and go live"}
          </h3>
          <p>
            Approval makes this candidate the default for new calculations.
            Existing projects keep their current model and can offer an update;
            saved runs remain unchanged.
          </p>
          {review.state === "ready" ? (
            <>
              {review.currentVersion !== review.baseVersion && (
                <p className="model-review-notice is-error">
                  The active model has changed. Upload again against the newest
                  version before releasing this workbook.
                </p>
              )}
              <label className="model-review-ack">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(event) => setAcknowledged(event.target.checked)}
                />
                <span>
                  I have reviewed this candidate’s mappings, baseline results,
                  scenarios, and Excel export. I approve its numerical release
                  with the recorded limitation that changed-input scenarios have
                  not been independently recalculated in Excel.
                </span>
              </label>
              <label>
                Release notes{" "}
                <span className="model-review-muted">(optional)</span>
                <textarea
                  maxLength={1000}
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Record your review or known limitations"
                />
              </label>
              <button
                className="admin-primary"
                disabled={
                  !acknowledged ||
                  approving ||
                  review.currentVersion !== review.baseVersion
                }
                onClick={() => void approve()}
                type="button"
              >
                {approving ? (
                  <>
                    <LoaderCircle className="admin-spin" size={16} /> Releasing…
                  </>
                ) : (
                  <>
                    <ShieldCheck size={16} /> Approve and go live
                  </>
                )}
              </button>
              <p className="model-review-muted">
                Approval records your account, the exact report revision,
                checksums, time, and notes.
              </p>
            </>
          ) : (
            <p className="model-review-notice">
              {review.state === "approved"
                ? "This candidate’s approval is recorded in the model history."
                : "Complete all preparation checks before approving this candidate."}
            </p>
          )}
        </div>
      )}
      {(review.state === "failed" || review.state === "mapping_required") &&
        !mappingOpen && (
          <div className="model-review-bottom">
            <button
              className="admin-secondary"
              onClick={() => {
                setRunning(false);
                setMappingOpen(true);
              }}
              type="button"
            >
              {review.state === "failed"
                ? "Review mapping & retry checks"
                : "Review mapping"}
            </button>
          </div>
        )}
      {mappingOpen && (
        <ModelMappingEditor
          key={review.revision}
          review={review}
          busy={busy}
          onCancel={() => setMappingOpen(false)}
          onSave={async (mapping) => {
            const body = await responseBody(
              await fetch(url, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ revision: review.revision, mapping }),
              }),
            );
            setReview(body.review);
            setMappingOpen(false);
            setError("");
            setWaiting(false);
            retries.current = 0;
            setRunning(true);
          }}
        />
      )}
    </section>
  );
}

function CandidateTrials({
  review,
  url,
}: {
  review: ModelReview;
  url: string;
}) {
  const manifest = review.manifest;
  const [inputs, setInputs] = useState<InputValues>(() =>
    manifest ? initialInputs(manifest, "example") : {},
  );
  const [group, setGroup] = useState(manifest?.groups[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<LiveResult | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [stale, setStale] = useState(false);
  useEffect(() => {
    if (manifest) {
      setInputs(initialInputs(manifest, "example"));
      setGroup(manifest.groups[0]?.id ?? "");
      setResult(null);
      setStale(false);
    }
  }, [manifest?.version]);
  if (!manifest || !review.baseline)
    return (
      <div className="admin-card model-review-panel">
        <p>
          Calculated results will appear after the baseline check completes.
        </p>
      </div>
    );
  const canTrial = ["ready", "approved", "failed"].includes(review.state);
  const visible = manifest.fields.filter((field) =>
    query
      ? `${field.label} ${field.unit}`
          .toLowerCase()
          .includes(query.toLowerCase())
      : field.group === group,
  );
  const calculate = async () => {
    const errors = validateInputs(inputs, manifest, true);
    if (errors.length) {
      setError(errors.slice(0, 8).join(" "));
      return;
    }
    setWorking(true);
    setError("");
    try {
      const body = await responseBody(
        await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "evaluate",
            version: review.candidateVersion,
            inputs,
          }),
        }),
      );
      setResult(body.result);
      setStale(false);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setWorking(false);
    }
  };
  return (
    <div className="admin-card model-review-panel">
      <div className="model-review-row">
        <div>
          <h3>Candidate results</h3>
          <p className="model-review-muted">
            The baseline uses the uploaded workbook’s defaults. Trials change
            this review only.
          </p>
        </div>
        <button
          className="admin-secondary"
          disabled={working}
          onClick={() => {
            setInputs(initialInputs(manifest, "example"));
            setResult(null);
            setStale(false);
            setError("");
          }}
          type="button"
        >
          Restore baseline
        </button>
      </div>
      <details className="model-review-trial">
        <summary>Try different inputs</summary>
        <div className="model-review-row">
          <label>
            Input section
            <select
              value={group}
              onChange={(event) => setGroup(event.target.value)}
            >
              {manifest.groups.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Find an input
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search all inputs"
            />
          </label>
        </div>
        <fieldset
          disabled={working || !canTrial}
          className="model-review-inputs"
        >
          {visible.map((field) => (
            <label key={field.id}>
              {field.label}
              {field.year !== undefined ? ` · Year ${field.year}` : ""}
              <small>{field.unit}</small>
              {field.type === "select" ? (
                <select
                  value={String(inputs[field.id] ?? "")}
                  onChange={(event) => {
                    setInputs(
                      changeInput(
                        manifest,
                        inputs,
                        field.id,
                        event.target.value,
                      ),
                    );
                    setStale(true);
                  }}
                >
                  <option value="">Choose…</option>
                  {inputOptions(manifest, field, inputs).map((option) => (
                    <option key={option} value={option}>
                      {field.optionLabels?.[option] ?? option}
                    </option>
                  ))}
                </select>
              ) : field.type === "milestone" ? (
                <span className="model-review-milestone">
                  <input
                    type="radio"
                    name={field.radioGroup ?? "completion-year"}
                    checked={inputs[field.id] === "X"}
                    onChange={() => {
                      setInputs(changeInput(manifest, inputs, field.id, "X"));
                      setStale(true);
                    }}
                  />{" "}
                  Completion year
                </span>
              ) : (
                <input
                  type={field.type === "number" ? "number" : "text"}
                  step="any"
                  value={inputs[field.id] ?? ""}
                  onChange={(event) => {
                    setInputs(
                      changeInput(
                        manifest,
                        inputs,
                        field.id,
                        event.target.value === ""
                          ? null
                          : field.type === "number"
                            ? Number(event.target.value)
                            : event.target.value,
                      ),
                    );
                    setStale(true);
                  }}
                />
              )}
            </label>
          ))}
        </fieldset>
        {error && (
          <p className="admin-inline-error" role="alert">
            {error}
          </p>
        )}
        <div className="model-review-row">
          <p className="model-review-muted">
            {stale
              ? "Inputs changed. Run a trial to update these results."
              : "Trials do not change workbook defaults or create saved customer runs."}
          </p>
          <button
            className="admin-primary"
            disabled={working || !canTrial}
            onClick={() => void calculate()}
            type="button"
          >
            {working ? (
              <>
                <LoaderCircle className="admin-spin" size={16} /> Calculating…
              </>
            ) : (
              "Calculate trial"
            )}
          </button>
        </div>
      </details>
      <p className="model-review-result-label">
        {result
          ? stale
            ? "Previous trial results · inputs have changed"
            : "Trial results"
          : "Validated baseline results"}
      </p>
      {!!(result ?? review.baseline).inputFeedback?.length && (
        <details>
          <summary>Interim input feedback</summary>
          <div className="model-review-feedback">
            {(result ?? review.baseline).inputFeedback!.map((item) => (
              <article key={item.id}>
                <span>{item.label}</span>
                <strong>
                  {typeof item.value === "number"
                    ? item.value.toLocaleString(undefined, {
                        maximumFractionDigits: 4,
                      })
                    : (item.value ?? "—")}{" "}
                  <small>{item.unit}</small>
                </strong>
              </article>
            ))}
          </div>
        </details>
      )}
      <WorkbookOutputs manifest={manifest} result={result ?? review.baseline} />
    </div>
  );
}
