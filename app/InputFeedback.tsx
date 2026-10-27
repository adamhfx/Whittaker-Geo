"use client";
import {useId} from "react";
import type {InputFeedbackSpec,InputFeedbackValue} from "@/lib/types";
import {formatOutputValue} from "@/lib/live-calculation";
import "./input-feedback.css";

export function InputFeedback({specs,values,isStale}:{specs:InputFeedbackSpec[];values?:InputFeedbackValue[];isStale:boolean}) {
  const headingId=useId();
  if (!specs.length) return null;
  const calculated=values !== undefined;
  const visible=specs.filter(spec => !calculated || values.some(item=>item.id===spec.id && item.value !== null && item.value !== ""));
  return <section className="input-feedback" aria-labelledby={headingId}>
    <header><h4 id={headingId}>Calculated feedback</h4>
      <span className={isStale ? "input-feedback__status is-stale" : "input-feedback__status"}>
        {!calculated ? "Not calculated yet" : isStale ? "Inputs changed" : "Current results"}
      </span>
    </header>
    <p className="input-feedback__hint" role="status">
      {!calculated ? "Click Calculate results to see these interim values for your inputs."
        : isStale ? "These values are from the last successful calculation. Click Update results when your edits are ready."
        : "Read-only interim values from the same calculation as the dashboard."}
    </p>
    {visible.length > 0 ? <dl>{visible.map(spec=>{
      const item=values?.find(value=>value.id===spec.id);
      return <div key={spec.id}><dt>{spec.label}</dt><dd>
        <strong>{item ? formatOutputValue(item.value,item.format) : "—"}</strong>
        {spec.unit && <span>{spec.unit}</span>}
      </dd></div>;
    })}</dl> : <p className="small">No interim values apply to this scenario.</p>}
  </section>;
}
