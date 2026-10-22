"use client";

import { useCallback, useEffect, useState } from "react";
import type { InputValues, Manifest } from "@/lib/types";
import { validateInputs } from "@/lib/validation";
import {
  LatestEvaluationGate,
  liveEvaluationKey,
  requestLiveCalculation,
  scheduleDebouncedEvaluation,
  type LiveCalculationResult,
} from "@/lib/live-calculation";

export const LIVE_CALCULATION_DEBOUNCE_MS = 450;

export type LiveCalculationState =
  | { status: "blocked"; errors: string[]; result: null; error: null }
  | { status: "invalid"; errors: string[]; result: null; error: null }
  | { status: "debouncing"; errors: []; result: null; error: null }
  | { status: "updating"; errors: []; result: null; error: null }
  | {
      status: "success";
      errors: [];
      result: LiveCalculationResult;
      error: null;
    }
  | { status: "error"; errors: []; result: null; error: string };

type Snapshot = {
  inputKey: string;
  status: "updating" | "success" | "error";
  result?: LiveCalculationResult;
  error?: string;
};

export function useLiveCalculation({
  manifest,
  inputs,
  enabled,
  endpoint,
}: {
  manifest: Manifest;
  inputs: InputValues;
  enabled: boolean;
  endpoint?: string;
}): LiveCalculationState & { retry: () => void } {
  const [gate] = useState(() => new LatestEvaluationGate());
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const inputKey = liveEvaluationKey(
    manifest.id,
    manifest.version,
    inputs,
    endpoint,
  );
  const validationErrors = validateInputs(inputs, manifest, true);
  const validationKey = validationErrors.join("\u0000");

  useEffect(() => {
    gate.invalidate();
    if (!enabled || validationKey) {
      setSnapshot(null);
      return;
    }

    const cancelDebounce = scheduleDebouncedEvaluation(() => {
      const lease = gate.begin();
      setSnapshot({ inputKey, status: "updating" });

      void requestLiveCalculation(
        manifest.id,
        manifest.version,
        inputs,
        lease.signal,
        undefined,
        undefined,
        endpoint,
      )
        .then((result) => {
          if (!lease.isCurrent()) return;
          setSnapshot({ inputKey, status: "success", result });
        })
        .catch((requestError: unknown) => {
          if (!lease.isCurrent()) return;
          setSnapshot({
            inputKey,
            status: "error",
            error:
              requestError instanceof Error
                ? requestError.message
                : "Live results could not be updated.",
          });
        });
    }, LIVE_CALCULATION_DEBOUNCE_MS);

    return () => {
      cancelDebounce();
      gate.invalidate();
    };
  }, [
    enabled,
    gate,
    inputKey,
    manifest.id,
    manifest.version,
    endpoint,
    retryCount,
    validationKey,
  ]);

  const retry = useCallback(() => {
    setSnapshot(null);
    setRetryCount((count) => count + 1);
  }, []);

  if (!enabled)
    return { status: "blocked", errors: [], result: null, error: null, retry };
  if (validationErrors.length > 0)
    return {
      status: "invalid",
      errors: validationErrors,
      result: null,
      error: null,
      retry,
    };

  if (!snapshot || snapshot.inputKey !== inputKey)
    return {
      status: "debouncing",
      errors: [],
      result: null,
      error: null,
      retry,
    };
  if (snapshot.status === "updating")
    return { status: "updating", errors: [], result: null, error: null, retry };
  if (snapshot.status === "error")
    return {
      status: "error",
      errors: [],
      result: null,
      error: snapshot.error || "Live results could not be updated.",
      retry,
    };
  if (!snapshot.result)
    return {
      status: "debouncing",
      errors: [],
      result: null,
      error: null,
      retry,
    };
  return {
    status: "success",
    errors: [],
    result: snapshot.result,
    error: null,
    retry,
  };
}
