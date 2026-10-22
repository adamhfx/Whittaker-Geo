"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ArrowLeft, Info } from "lucide-react";
import "./help-dialog.css";
import { organizeHelp } from "@/lib/help-content";
import { HelpContent } from "./HelpContent";

type HelpDialogProps = {
  title: string;
  body: string;
  triggerLabel?: string;
};


export function HelpDialog({
  title,
  body,
  triggerLabel = `More information about ${title}`,
}: HelpDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const id = useId();
  const titleId = `${id}-title`;
  const bodyId = `${id}-body`;
  const topics = organizeHelp(body);

  useEffect(() => {
    if (!isOpen) return;

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
  }, [isOpen]);

  function closeDialog() {
    const dialog = dialogRef.current;
    if (dialog?.open) {
      dialog.dataset.state = "closed";
      dialog.close();
    }
    setIsOpen(false);
  }

  function restoreTriggerFocus() {
    const trigger = triggerRef.current;
    if (trigger?.isConnected) {
      window.requestAnimationFrame(() => {
        if (trigger.isConnected) trigger.focus({ preventScroll: true });
      });
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="help-dialog-trigger"
        aria-label={triggerLabel}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls={`${id}-dialog`}
        onClick={() => setIsOpen(true)}
      >
        <Info aria-hidden="true" focusable="false" />
      </button>
      <dialog
        ref={dialogRef}
        id={`${id}-dialog`}
        className={`help-dialog${topics.length > 1 ? " help-dialog--guide" : ""}`}
        aria-labelledby={titleId}
        data-state="closed"
        onCancel={(event) => {
          event.preventDefault();
          closeDialog();
        }}
        onClose={(event) => {
          if (event.currentTarget.open) return;
          setIsOpen(false);
          restoreTriggerFocus();
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) closeDialog();
        }}
      >
        <section className="help-dialog__panel">
          <header className="help-dialog__header">
            <h2 id={titleId}>{title}</h2>
            <button
              type="button"
              className="help-dialog__return"
              autoFocus
              onClick={closeDialog}
            >
              <ArrowLeft aria-hidden="true" focusable="false" />
              <span>return</span>
            </button>
          </header>
          <div id={bodyId} className="help-dialog__body">
            {isOpen && <HelpContent topics={topics} accordionName={`${id}-topics`} />}
          </div>
        </section>
      </dialog>
    </>
  );
}
