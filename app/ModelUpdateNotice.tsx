"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, LoaderCircle, RefreshCw } from "lucide-react";
import { planModelUpgrade, updatedCalculationName } from "@/lib/model-updates";
import type { Calculation, InputValues, Manifest } from "@/lib/types";
import "./ModelUpdateNotice.css";

type ModelUpdateNoticeProps = {
  sourceIdentity: string;
  calculation: Calculation | null;
  manifest: Manifest;
  inputs: InputValues;
  name: string;
  canWrite: boolean;
  hasWriteAccess: boolean;
  onUpdatedCopy: (calculation: Calculation) => void;
  onUpdatedDraft: (manifest: Manifest, inputs: InputValues) => void;
};

type CheckKind = "background" | "modal";
type CheckResult =
  | { status: "available"; manifest: Manifest }
  | { status: "unavailable" }
  | { status: "error"; message: string }
  | { status: "stale" };

type LatestRecord = { sourceKey: string; manifest: Manifest | null };

function responseError(value: unknown, fallback: string) {
  return value && typeof value === "object" && "error" in value && typeof value.error === "string"
    ? value.error
    : fallback;
}

function displayValue(value: string | number | null) {
  return value == null || value === "" ? "Blank" : String(value);
}

export function ModelUpdateNotice({
  sourceIdentity,
  calculation,
  manifest,
  inputs,
  name,
  canWrite,
  hasWriteAccess,
  onUpdatedCopy,
  onUpdatedDraft,
}: ModelUpdateNoticeProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const requestStateRef = useRef({
    generation: 0,
    sequence: { background: 0, modal: 0 },
    controllers: { background: null as AbortController | null, modal: null as AbortController | null },
  });
  const modalOpenRef = useRef(false);
  const attemptRef = useRef<{ fingerprint: string; key: string } | null>(null);
  const sourceKey = `${sourceIdentity}:${manifest.id}@${manifest.version}`;
  const sourceKeyRef = useRef(sourceKey);
  sourceKeyRef.current = sourceKey;
  const [latestRecord, setLatestRecord] = useState<LatestRecord | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const [creating, setCreating] = useState(false);
  const [modalError, setModalError] = useState("");
  const [modalMessage, setModalMessage] = useState("");
  const headingId = useId();
  const bodyId = useId();

  const currentTarget = latestRecord?.sourceKey === sourceKey ? latestRecord.manifest : null;
  const migrationPlan = useMemo(
    () => currentTarget ? planModelUpgrade(manifest, currentTarget, inputs) : null,
    [currentTarget, inputs, manifest],
  );
  const reviewFieldIds = useMemo(
    () => new Set(migrationPlan?.reviewFields.map((field) => field.id) ?? []),
    [migrationPlan],
  );

  const checkLatest = useCallback(async (kind: CheckKind, showError = false): Promise<CheckResult> => {
    if (kind === "background" && modalOpenRef.current) return { status: "stale" };

    const requests = requestStateRef.current;
    const generation = requests.generation;
    const sequence = ++requests.sequence[kind];
    if (kind === "modal") requests.controllers.background?.abort();
    requests.controllers[kind]?.abort();
    const controller = new AbortController();
    requests.controllers[kind] = controller;
    if (kind === "modal") {
      setChecking(true);
      if (showError) setModalError("");
    }

    const isCurrent = () =>
      requests.generation === generation &&
      requests.sequence[kind] === sequence &&
      sourceKeyRef.current === sourceKey;

    try {
      const response = await fetch(`/api/calculators/${encodeURIComponent(manifest.id)}`, {
        cache: "no-store",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      let data: unknown;
      try {
        data = await response.json();
      } catch {
        throw new Error("The latest model response could not be read.");
      }
      if (!response.ok) throw new Error(responseError(data, "The latest model could not be checked."));
      if (!data || typeof data !== "object" || !("manifest" in data))
        throw new Error("The latest model response was incomplete.");

      const result = data as { manifest: Manifest; approved?: boolean };
      const target = result.approved === true &&
        result.manifest?.id === manifest.id &&
        typeof result.manifest.version === "string" &&
        result.manifest.version !== manifest.version
        ? result.manifest
        : null;
      if (!isCurrent()) return { status: "stale" };

      setLatestRecord({ sourceKey, manifest: target });
      if (kind === "modal") {
        setModalError("");
        setModalMessage(target ? "" : "No newer approved model version is currently available.");
      }
      return target ? { status: "available", manifest: target } : { status: "unavailable" };
    } catch (error) {
      if (controller.signal.aborted || !isCurrent()) return { status: "stale" };
      const message = error instanceof Error ? error.message : "The latest model could not be checked.";
      if (kind === "modal" && showError) setModalError(message);
      return { status: "error", message };
    } finally {
      if (isCurrent() && kind === "modal") setChecking(false);
      if (requests.controllers[kind] === controller) requests.controllers[kind] = null;
    }
  }, [manifest.id, manifest.version, sourceKey]);

  useEffect(() => {
    const requests = requestStateRef.current;
    requests.generation += 1;
    const generation = requests.generation;
    requests.controllers.background?.abort();
    requests.controllers.modal?.abort();
    requests.controllers.background = null;
    requests.controllers.modal = null;
    modalOpenRef.current = false;
    if (dialogRef.current?.open) dialogRef.current.close();
    setModalOpen(false);
    setChecking(false);
    setCreating(false);
    setLatestRecord(null);
    setModalError("");
    setModalMessage("");
    void checkLatest("background");

    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void checkLatest("background");
    };
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      if (requests.generation === generation) requests.generation += 1;
      requests.controllers.background?.abort();
      requests.controllers.modal?.abort();
      requests.controllers.background = null;
      requests.controllers.modal = null;
    };
  }, [checkLatest, sourceKey]);

  useEffect(() => {
    if (!modalOpen) return;
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;
    dialog.dataset.state = "opening";
    dialog.showModal();
    let firstFrame = 0;
    let secondFrame = 0;
    firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        if (dialog.open) dialog.dataset.state = "open";
      });
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
      if (dialog.open) dialog.close();
    };
  }, [modalOpen]);

  function closeReview() {
    if (creating) return;
    modalOpenRef.current = false;
    if (dialogRef.current?.open) {
      dialogRef.current.dataset.state = "closed";
      dialogRef.current.close();
    }
    setModalOpen(false);
  }

  async function openReview() {
    modalOpenRef.current = true;
    setModalOpen(true);
    setModalError("");
    setModalMessage("");
    const result = await checkLatest("modal", true);
    if (result.status === "unavailable")
      setModalMessage("No newer approved model version is currently available.");
  }

  function idempotencyKeyFor(target: Manifest, sourceInputs: InputValues, copyLabel: string) {
    const fingerprint = JSON.stringify({
      sourceIdentity,
      calculationId: calculation?.id ?? null,
      sourceRevision: calculation?.revision ?? null,
      sourceVersion: manifest.version,
      targetVersion: target.version,
      name: copyLabel,
      inputs: Object.entries(sourceInputs).sort(([left], [right]) => left.localeCompare(right)),
    });
    if (attemptRef.current?.fingerprint !== fingerprint) {
      if (typeof window.crypto?.randomUUID !== "function")
        throw new Error("This browser cannot create a safe retry key. Update the browser and try again.");
      attemptRef.current = { fingerprint, key: window.crypto.randomUUID() };
    }
    return attemptRef.current.key;
  }

  async function createOrUpdate() {
    if (!currentTarget || !migrationPlan || !canWrite || checking || creating) return;
    const reviewedVersion = currentTarget.version;
    const operationSourceKey = sourceKey;
    const operationGeneration = requestStateRef.current.generation;
    const operationIsCurrent = () =>
      sourceKeyRef.current === operationSourceKey &&
      requestStateRef.current.generation === operationGeneration;
    setCreating(true);
    setModalError("");
    setModalMessage("");
    try {
      const latest = await checkLatest("modal", true);
      if (!operationIsCurrent()) return;
      if (latest.status === "error") return;
      if (latest.status !== "available") {
        setModalMessage("No newer approved model version is currently available.");
        return;
      }
      if (latest.manifest.version !== reviewedVersion) {
        setModalMessage("The latest approved model changed. Review the updated fields and defaults, then choose the update again to continue.");
        return;
      }

      const latestPlan = planModelUpgrade(manifest, latest.manifest, inputs);
      if (calculation) {
        const copyLabel = updatedCalculationName(name, latest.manifest.version);
        const idempotencyKey = idempotencyKeyFor(latest.manifest, inputs, copyLabel);
        const response = await fetch(`/api/calculations/${encodeURIComponent(calculation.id)}/upgrade`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            targetVersion: latest.manifest.version,
            sourceRevision: calculation.revision,
            inputs,
            name: copyLabel,
            idempotencyKey,
          }),
        });
        let data: unknown;
        try {
          data = await response.json();
        } catch {
          throw new Error("The updated copy response could not be read. You can retry safely.");
        }
        if (!response.ok) throw new Error(responseError(data, "The updated copy could not be created."));
        if (!data || typeof data !== "object" || !("calculation" in data) || !data.calculation)
          throw new Error("The updated copy response was incomplete. You can retry safely.");
        // The POST may finish after the user has switched accounts/projects or
        // this notice has unmounted. Never let an old response navigate the
        // current workspace.
        if (!operationIsCurrent()) return;
        modalOpenRef.current = false;
        setModalOpen(false);
        onUpdatedCopy(data.calculation as Calculation);
      } else {
        if (!operationIsCurrent()) return;
        modalOpenRef.current = false;
        setModalOpen(false);
        onUpdatedDraft(latest.manifest, latestPlan.inputs);
      }
    } catch (error) {
      if (operationIsCurrent())
        setModalError(error instanceof Error ? error.message : "The model update could not be completed.");
    } finally {
      if (operationIsCurrent()) setCreating(false);
    }
  }

  const actionLabel = calculation ? "Create updated copy" : "Update draft";

  return (
    <>
      {currentTarget && (
        <section className="model-update-notice" aria-labelledby={`${headingId}-banner-title`}>
          <div className="model-update-notice__copy">
            <div className="eyebrow">Model update available</div>
            <h2 id={`${headingId}-banner-title`}>{manifest.version} → {currentTarget.version}</h2>
            <p>{calculation ? "Review the latest approved model, then create a separate updated copy." : "Review the latest approved model, then update this unsaved draft when you are ready."}</p>
          </div>
          <button ref={triggerRef} type="button" className="btn primary" onClick={() => void openReview()}>
            Review update
            <ArrowRight className="model-update-notice__review-icon" size={16} aria-hidden="true" />
          </button>
        </section>
      )}

      <dialog
        ref={dialogRef}
        className="model-update-dialog"
        aria-labelledby={headingId}
        aria-describedby={bodyId}
        aria-modal="true"
        onCancel={(event) => { event.preventDefault(); closeReview(); }}
        onClose={(event) => {
          if (event.currentTarget.open) return;
          modalOpenRef.current = false;
          setModalOpen(false);
          window.requestAnimationFrame(() => {
            if (triggerRef.current?.isConnected) triggerRef.current.focus({ preventScroll: true });
          });
        }}
        onClick={(event) => { if (event.target === event.currentTarget) closeReview(); }}
      >
        <section className="model-update-dialog__panel">
          <header className="model-update-dialog__header">
            <div>
              <div className="eyebrow">Model update review</div>
              <h2 id={headingId}>{currentTarget ? `${manifest.version} → ${currentTarget.version}` : manifest.version}</h2>
            </div>
            <button type="button" className="model-update-dialog__return" autoFocus onClick={closeReview} disabled={creating}>
              <ArrowLeft size={16} aria-hidden="true" />
              <span>Return</span>
            </button>
          </header>
          <div className="model-update-dialog__body" id={bodyId}>
            {checking && <p className="model-update-dialog__status" role="status"><LoaderCircle className="live-calculation__spinner" aria-hidden="true" />Checking the latest approved model…</p>}
            {modalError && <p className="model-update-dialog__error" role="alert">{modalError}</p>}
            {modalMessage && <p className="model-update-dialog__status" role="status">{modalMessage}</p>}
            {migrationPlan && (
              <>
                <p className="model-update-dialog__intro">The original calculation and its completed runs stay unchanged. This review uses your current unsaved inputs.</p>
                <div className="model-update-dialog__summary" aria-label="Migration summary">
                  <div><strong>{migrationPlan.copiedCount}</strong><span>compatible inputs carried forward</span></div>
                  <div><strong>{migrationPlan.reviewFields.length}</strong><span>fields to review</span></div>
                  <div><strong>{migrationPlan.removedCount}</strong><span>inputs removed from the new version</span></div>
                </div>
                <section className="model-update-dialog__section" aria-labelledby={`${headingId}-fields-title`}>
                  <h3 id={`${headingId}-fields-title`}>Review fields</h3>
                  {migrationPlan.reviewFields.length ? (
                    <ul className="model-update-dialog__list">
                      {migrationPlan.reviewFields.map((field) => (
                        <li key={field.id}><strong>{field.label}</strong><span>{field.reason}</span></li>
                      ))}
                    </ul>
                  ) : <p>No fields need additional review.</p>}
                </section>
                <section className="model-update-dialog__section" aria-labelledby={`${headingId}-defaults-title`}>
                  <h3 id={`${headingId}-defaults-title`}>Changed defaults</h3>
                  {migrationPlan.defaultChanges.length ? (
                    <ul className="model-update-dialog__defaults">
                      {migrationPlan.defaultChanges.map((change) => {
                        const needsReview = reviewFieldIds.has(change.id);
                        return (
                          <li key={change.id}>
                            <strong>{change.label}</strong>
                            <div>
                              <span>{needsReview ? "Previous value" : "Your value (kept)"}: {displayValue(change.current)}</span>
                              {needsReview && <span className="model-update-dialog__needs-review">Needs review</span>}
                              <span>New model default: {displayValue(change.newDefault)}</span>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  ) : <p>No defaults changed.</p>}
                </section>
                {!canWrite && !hasWriteAccess && <p className="model-update-dialog__readonly">An active subscription is required to {calculation ? "create an updated copy" : "update this draft"}.</p>}
                {!canWrite && hasWriteAccess && <p className="model-update-dialog__readonly" role="status">Finish the current save or calculation before updating this model.</p>}
              </>
            )}
          </div>
          <footer className="model-update-dialog__actions">
            <button type="button" className="btn" onClick={closeReview} disabled={creating}>Cancel</button>
            <button
              type="button"
              className="btn primary"
              onClick={() => void createOrUpdate()}
              disabled={!canWrite || !migrationPlan || checking || creating}
            >
              {creating ? <><LoaderCircle className="live-calculation__action-spinner" aria-hidden="true" />Updating…</> : actionLabel}
            </button>
            {modalError && !creating && <button type="button" className="btn ghost" onClick={() => void checkLatest("modal", true)}>
              <RefreshCw size={15} aria-hidden="true" />Check again
            </button>}
          </footer>
        </section>
      </dialog>
    </>
  );
}
