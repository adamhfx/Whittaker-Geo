"use client";

import {
  AlertCircle,
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronDown,
  FileSpreadsheet,
  Info,
  RefreshCw,
  Upload,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./admin-models.css";
import { AdminModelReview } from "./AdminModelReview";

type Version = { version: string; approved: boolean; createdAt: string };
type Validation = { checks: string[]; warnings: string[] };
type ModelUpload = {
  id: string;
  version: string;
  fileName: string;
  status: string;
  createdAt: string;
  notes?: string | null;
  validation?: Validation | null;
  preparation?: { state: string; phase: string; candidate_version: string } | null;
};
type Calculator = {
  id: string;
  name: string;
  currentVersion: string | null;
  versions: Version[];
  uploads: ModelUpload[];
};

export type AdminModelsProps = { onBack: () => void };

const MAX_BYTES = 20 * 1024 * 1024;
const dateTime = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" });
};

async function readError(response: Response, fallback: string) {
  try {
    const body = await response.json();
    if (typeof body?.error === "string") return body.error;
    if (typeof body?.message === "string") return body.message;
  } catch {
    // The response may be an HTML or empty error response.
  }
  return `${fallback} (HTTP ${response.status})`;
}

export default function AdminModels({ onBack }: AdminModelsProps) {
  const [calculators, setCalculators] = useState<Calculator[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [notes, setNotes] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [success, setSuccess] = useState("");
  const [activateVersion, setActivateVersion] = useState<string | null>(null);
  const [activating, setActivating] = useState(false);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [autoStartReview, setAutoStartReview] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  const selected = useMemo(
    () => calculators.find((calculator) => calculator.id === selectedId) ?? null,
    [calculators, selectedId],
  );

  const load = useCallback(async (quiet = false) => {
    setError("");
    quiet ? setRefreshing(true) : setLoading(true);
    try {
      const response = await fetch("/api/admin/models", { cache: "no-store" });
      if (!response.ok) throw new Error(await readError(response, "Unable to load calculator workbooks"));
      const body = await response.json();
      if (!Array.isArray(body?.calculators)) throw new Error("The calculator list could not be read.");
      setCalculators(body.calculators);
      setSelectedId((current) =>
        body.calculators.some((item: Calculator) => item.id === current)
          ? current
          : body.calculators[0]?.id ?? "",
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load calculator workbooks");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !activateVersion) return;
    dialog.showModal();
    dialog.querySelector<HTMLButtonElement>("[data-dialog-close]")?.focus();
    return () => { if (dialog.open) dialog.close(); };
  }, [activateVersion]);

  const chooseFile = (candidate: File | undefined) => {
    setUploadError("");
    setSuccess("");
    if (!candidate) return;
    if (!candidate.name.toLowerCase().endsWith(".xlsx")) {
      setFile(null);
      setUploadError("Choose an .xlsx workbook.");
      return;
    }
    if (candidate.size > MAX_BYTES) {
      setFile(null);
      setUploadError("This workbook is larger than the 20 MB limit.");
      return;
    }
    setFile(candidate);
  };

  const clearUploadDraft = () => {
    setFile(null);
    setNotes("");
    setUploadError("");
    setSuccess("");
    if (inputRef.current) inputRef.current.value = "";
  };

  const upload = async () => {
    if (!file || !selected) return;
    setUploading(true);
    setUploadError("");
    setSuccess("");
    const form = new FormData();
    form.append("file", file);
    form.append("calculatorId", selected.id);
    form.append("notes", notes.trim());
    try {
      const response = await fetch("/api/admin/models", { method: "POST", body: form });
      if (!response.ok) throw new Error(await readError(response, "Workbook upload failed"));
      const body = await response.json();
      clearUploadDraft();
      setSuccess(body.duplicate ? "This workbook is already saved. Open its preparation review below." : "Workbook uploaded. Preparing a private candidate for your review.");
      setReviewId(body.upload.id); setAutoStartReview(true);
      await load(true);
    } catch (caught) {
      setUploadError(caught instanceof Error ? caught.message : "Workbook upload failed");
    } finally {
      setUploading(false);
    }
  };

  const activate = async () => {
    if (!selected || !activateVersion) return;
    setActivating(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/models/${encodeURIComponent(selected.id)}/activate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: activateVersion, expectedCurrentVersion: selected.currentVersion }),
      });
      if (!response.ok) throw new Error(await readError(response, "Unable to make this version current"));
      dialogRef.current?.close();
      setActivateVersion(null);
      setSuccess(`Version ${activateVersion} is now current. Existing upload history was preserved.`);
      await load(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to make this version current");
      dialogRef.current?.close();
      setActivateVersion(null);
    } finally {
      setActivating(false);
    }
  };

  return (
    <main className="admin-models-page">
      <div className="admin-models-shell">
        <header className="admin-models-header">
          <button className="admin-back" onClick={onBack} type="button"><ArrowLeft size={17} /> Back to workspace</button>
          <div>
            <p className="admin-kicker">Admin · Model governance</p>
            <h1>Calculator workbooks</h1>
            <p className="admin-lede">Upload private workbook revisions, review their checks, and control which approved version powers the calculator.</p>
          </div>
          <button className="admin-refresh" onClick={() => void load(true)} disabled={loading || refreshing} type="button" aria-label="Refresh calculator workbooks">
            <RefreshCw size={16} className={refreshing ? "admin-spin" : ""} /> Refresh
          </button>
        </header>

        {error && <div className="admin-alert admin-alert-error" role="alert"><AlertCircle size={18} /> <span>{error}</span><button onClick={() => void load()} type="button">Retry</button></div>}
        {success && <div className="admin-alert admin-alert-success" role="status"><CheckCircle2 size={18} /> <span>{success}</span><button onClick={() => setSuccess("")} type="button" aria-label="Dismiss success"><X size={16} /></button></div>}

        {reviewId ? <AdminModelReview id={reviewId} autoStart={autoStartReview} onBack={() => { setReviewId(null); setAutoStartReview(false); void load(true); }} onApproved={() => void load(true)} /> : loading ? <div className="admin-loading" role="status">Loading calculator workbooks…</div> : (
          <>
            <section className="admin-card admin-selector-card" aria-labelledby="calculator-label">
              <label id="calculator-label" htmlFor="calculator-select">Calculator</label>
              <div className="admin-select-wrap"><select id="calculator-select" value={selectedId} onChange={(event) => { setSelectedId(event.target.value); clearUploadDraft(); }} disabled={!calculators.length || uploading}>
                {!calculators.length && <option value="">No calculators available</option>}
                {calculators.map((calculator) => <option key={calculator.id} value={calculator.id}>{calculator.name}</option>)}
              </select><ChevronDown size={18} aria-hidden="true" /></div>
            </section>

            {selected ? <>
              <section className="admin-card admin-upload-card" aria-labelledby="upload-title">
                <div className="admin-card-heading"><div><p className="admin-kicker">Private workbook upload</p><h2 id="upload-title">Add a new version</h2></div><FileSpreadsheet size={29} aria-hidden="true" /></div>
                <p className="admin-card-copy">Upload a private <strong>.xlsx</strong> workbook up to 20 MB. We will prepare a runtime, compare its results with saved Excel values, check input scenarios, and generate an Excel export. Review the candidate before approving it to go live.</p>
                <input ref={inputRef} className="admin-file-input" id="workbook-file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => chooseFile(event.target.files?.[0])} disabled={uploading} />
                <label className={`admin-dropzone ${file ? "has-file" : ""}`} htmlFor="workbook-file"><Upload size={22} /><span>{file ? file.name : "Choose an .xlsx workbook"}</span><small>{file ? `${(file.size / 1024 / 1024).toFixed(1)} MB · ready to upload` : "Private to admins · 20 MB maximum"}</small></label>
                <label className="admin-notes-label" htmlFor="upload-notes">Notes <span>{notes.length}/1000</span></label>
                <textarea id="upload-notes" maxLength={1000} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="What changed in this workbook?" disabled={uploading} />
                {uploadError && <p className="admin-inline-error" role="alert"><AlertCircle size={15} />{uploadError}</p>}
                <div className="admin-upload-footer"><p><Info size={15} /> The live calculator stays unchanged until you approve.</p><button className="admin-primary" onClick={() => void upload()} disabled={!file || uploading} type="button">{uploading ? "Uploading…" : "Upload & prepare"}<Upload size={16} /></button></div>
              </section>

              <section className="admin-card admin-current-card" aria-labelledby="current-title">
                <div className="admin-card-heading"><div><p className="admin-kicker">Live calculator</p><h2 id="current-title">Active version</h2></div><span className="admin-live-badge"><span /> Current</span></div>
                <div className="admin-current-version"><strong>{selected.currentVersion || "No active version"}</strong><span>{selected.currentVersion && selected.versions.some((version) => version.version === selected.currentVersion && version.approved) ? "This approved version is used for new calculations." : selected.currentVersion ? "This version is current, but its approval record needs attention." : "Approve a reviewed version to activate it."}</span></div>
              </section>

              <section className="admin-card" aria-labelledby="reviewed-title">
                <div className="admin-card-heading"><div><p className="admin-kicker">Approved versions</p><h2 id="reviewed-title">Available to make current</h2></div></div>
                {selected.versions.filter((version) => version.approved && version.version !== selected.currentVersion).length === 0 ? <p className="admin-empty">No other approved versions are ready to activate.</p> : <div className="admin-reviewed-list">{selected.versions.filter((version) => version.approved && version.version !== selected.currentVersion).map((version) => <div className="admin-reviewed-item" key={version.version}><div><strong>v{version.version}</strong><span>Approved {dateTime(version.createdAt)}</span></div><button className="admin-secondary" onClick={() => setActivateVersion(version.version)} disabled={activating} type="button">Make current</button></div>)}</div>}
              </section>

              <section className="admin-card" aria-labelledby="history-title">
                <div className="admin-card-heading"><div><p className="admin-kicker">Traceable revisions</p><h2 id="history-title">Upload history</h2></div><span className="admin-history-count">{selected.uploads.length} {selected.uploads.length === 1 ? "upload" : "uploads"}</span></div>
                {selected.uploads.length === 0 ? <p className="admin-empty">No workbook uploads yet.</p> : <div className="admin-history-list">{selected.uploads.map((uploadItem) => { const reviewStatus = uploadItem.preparation?.state?.replaceAll("_", " ") ?? (uploadItem.status.toLowerCase() === "review_required" ? "Not prepared" : uploadItem.status); const statusClass = uploadItem.status.toLowerCase().replace(/\s+/g, "_"); return <article className="admin-history-item" key={uploadItem.id}><div className="admin-history-main"><div className="admin-version-line"><strong>v{uploadItem.version}</strong><span className={`admin-status admin-status-${statusClass}`}>{reviewStatus}</span>{uploadItem.version === selected.currentVersion && <span className="admin-current-label">Current</span>}</div><p className="admin-file-name"><FileSpreadsheet size={15} />{uploadItem.fileName}</p><p className="admin-meta">Uploaded {dateTime(uploadItem.createdAt)}</p>{uploadItem.notes && <p className="admin-history-notes">{uploadItem.notes}</p>}</div><div className="admin-history-actions">{uploadItem.status !== "rejected" && <button className="admin-secondary" type="button" onClick={() => { setAutoStartReview(false); setReviewId(uploadItem.id); }}>{uploadItem.preparation?.state === "approved" ? "View release" : uploadItem.preparation?.state === "ready" ? "Review candidate" : "Open preparation"}</button>}{!selected.versions.some((version) => version.version === uploadItem.version && version.approved) && <span className="admin-awaiting">Review required</span>}</div><div className="admin-validation"><div><Check size={15} /> Checks <span>{uploadItem.validation?.checks?.length ?? 0}</span></div>{(uploadItem.validation?.checks ?? []).length > 0 && <ul>{uploadItem.validation?.checks.map((check) => <li key={check}>{check}</li>)}</ul>}{(uploadItem.validation?.warnings ?? []).length > 0 && <><div className="admin-warnings"><AlertCircle size={15} /> <span>{uploadItem.validation?.warnings.length} warning{uploadItem.validation?.warnings.length === 1 ? "" : "s"}</span></div><ul className="admin-warning-list">{uploadItem.validation?.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></>}</div></article>; })}</div>}
              </section>
            </> : <div className="admin-empty-state">There are no calculators to manage.</div>}
          </>
        )}
      </div>

      {activateVersion && selected && <dialog ref={dialogRef} className="admin-dialog" aria-labelledby="activate-title" onCancel={(event) => { if (activating) event.preventDefault(); else setActivateVersion(null); }}><button className="admin-dialog-close" data-dialog-close onClick={() => { dialogRef.current?.close(); setActivateVersion(null); }} disabled={activating} type="button" aria-label="Close"><X size={18} /></button><div className="admin-dialog-icon"><CheckCircle2 size={24} /></div><h2 id="activate-title">Make version {activateVersion} current?</h2><p>Version <strong>{activateVersion}</strong> will become the active workbook for <strong>{selected.name}</strong>. Existing upload history and the current version will be preserved.</p><div className="admin-dialog-actions"><button className="admin-secondary" onClick={() => { dialogRef.current?.close(); setActivateVersion(null); }} disabled={activating} type="button">Cancel</button><button className="admin-primary" onClick={() => void activate()} disabled={activating} type="button">{activating ? "Activating…" : "Make current"}</button></div></dialog>}
    </main>
  );
}
