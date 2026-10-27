"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { InputValues, Manifest } from "@/lib/types";
import { validateInputs } from "@/lib/validation";
import {
  diagnoseCalculationInputs,
  type CalculationInputDiagnosis,
} from "@/lib/calculation-diagnostics";
import {
  LatestEvaluationGate,
  LiveCalculationRequestError,
  liveEvaluationKey,
  requestLiveCalculation,
  type LiveCalculationResult,
} from "@/lib/live-calculation";

export type LiveCalculationAttempt = {
  inputKey: string;
  status: "updating" | "success" | "error";
  error?: string;
  canRetry?: boolean;
  diagnosis?: CalculationInputDiagnosis;
};

export type LastSuccessfulCalculation = {
  scope: string;
  inputKey: string;
  inputs: InputValues;
  result: LiveCalculationResult;
};

export function clearCanceledCalculationAttempt(
  snapshot: LiveCalculationAttempt | null,
  canceledInputKey: string,
): LiveCalculationAttempt | null {
  return snapshot?.status === "updating" &&
    snapshot.inputKey === canceledInputKey
    ? null
    : snapshot;
}

type LiveCalculationStateBase = {
  result: LiveCalculationResult | null;
  isStale: boolean;
};

export type LiveCalculationState =
  | (LiveCalculationStateBase & {
      status: "blocked";
      errors: [];
      error: null;
      canRetry: false;
      diagnosis: null;
    })
  | (LiveCalculationStateBase & {
      status: "invalid";
      errors: string[];
      error: null;
      canRetry: false;
      diagnosis: null;
    })
  | (LiveCalculationStateBase & {
      status: "idle";
      errors: [];
      error: null;
      canRetry: false;
      diagnosis: null;
    })
  | (LiveCalculationStateBase & {
      status: "updating";
      errors: [];
      error: null;
      canRetry: false;
      diagnosis: null;
    })
  | (LiveCalculationStateBase & {
      status: "success";
      result: LiveCalculationResult;
      isStale: false;
      errors: [];
      error: null;
      canRetry: false;
      diagnosis: null;
    })
  | (LiveCalculationStateBase & {
      status: "error";
      errors: [];
      error: string;
      canRetry: boolean;
      diagnosis: CalculationInputDiagnosis | null;
    });

/**
 * Selects the visible state without discarding the last successful result when
 * the current inputs change. Attempts only describe the input snapshot they
 * were sent with, so a late or old error cannot be shown for newer inputs.
 */
export function selectLiveCalculationState({
  scope,
  inputKey,
  enabled,
  validationErrors,
  snapshot,
  lastSuccess,
}: {
  scope: string;
  inputKey: string;
  enabled: boolean;
  validationErrors: string[];
  snapshot: LiveCalculationAttempt | null;
  lastSuccess: LastSuccessfulCalculation | null;
}): LiveCalculationState {
  const successful = lastSuccess?.scope === scope ? lastSuccess : null;
  const result = successful?.result ?? null;
  const isStale = Boolean(result && successful?.inputKey !== inputKey);
  const base = { result, isStale };

  if (!enabled)
    return {
      ...base,
      status: "blocked",
      errors: [],
      error: null,
      canRetry: false,
      diagnosis: null,
    };

  if (validationErrors.length > 0)
    return {
      ...base,
      status: "invalid",
      errors: validationErrors,
      error: null,
      canRetry: false,
      diagnosis: null,
    };

  const currentAttempt = snapshot?.inputKey === inputKey ? snapshot : null;
  if (currentAttempt?.status === "updating")
    return {
      ...base,
      status: "updating",
      errors: [],
      error: null,
      canRetry: false,
      diagnosis: null,
    };

  if (currentAttempt?.status === "error")
    return {
      ...base,
      status: "error",
      errors: [],
      error: currentAttempt.error || "Live results could not be updated.",
      canRetry: currentAttempt.canRetry !== false,
      diagnosis: currentAttempt.diagnosis ?? null,
    };

  if (result && !isStale)
    return {
      ...base,
      status: "success",
      result,
      isStale: false,
      errors: [],
      error: null,
      canRetry: false,
      diagnosis: null,
    };

  return {
    ...base,
    status: "idle",
    errors: [],
    error: null,
    canRetry: false,
    diagnosis: null,
  };
}

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
}): LiveCalculationState & { calculate: () => void; retry: () => void } {
  const [gate] = useState(() => new LatestEvaluationGate());
  const [snapshot, setSnapshot] = useState<LiveCalculationAttempt | null>(null);
  const lastSuccess = useRef<LastSuccessfulCalculation | null>(null);
  const lastScope = useRef("");
  const activeInputKey = useRef<string | null>(null);
  const scope = liveEvaluationKey(manifest.id, manifest.version, {}, endpoint);
  const inputKey = liveEvaluationKey(
    manifest.id,
    manifest.version,
    inputs,
    endpoint,
  );
  const validationErrors = validateInputs(inputs, manifest, true);
  const validationKey = validationErrors.join("\u0000");

  useEffect(() => {
    if (lastScope.current && lastScope.current !== scope) {
      lastSuccess.current = null;
      setSnapshot((current) =>
        current?.inputKey === inputKey ? current : null,
      );
    }
    lastScope.current = scope;
  }, [inputKey, scope]);

  useEffect(() => {
    const activeKey = activeInputKey.current;
    if (activeKey && (!enabled || activeKey !== inputKey)) {
      gate.invalidate();
      activeInputKey.current = null;
      setSnapshot((current) =>
        clearCanceledCalculationAttempt(current, activeKey),
      );
    }
  }, [enabled, gate, inputKey]);

  useEffect(() => {
    return () => {
      activeInputKey.current = null;
      gate.invalidate();
    };
  }, [gate]);

  const calculate = useCallback(() => {
    if (!enabled || validationKey) return;

    const requestedInputs = { ...inputs };
    const requestedInputKey = inputKey;
    const requestedScope = scope;
    const lease = gate.begin();
    activeInputKey.current = requestedInputKey;
    setSnapshot({ inputKey: requestedInputKey, status: "updating" });

    void requestLiveCalculation(
      manifest.id,
      manifest.version,
      requestedInputs,
      lease.signal,
      undefined,
      undefined,
      endpoint,
    )
      .then((result) => {
        if (!lease.isCurrent()) return;
        if (activeInputKey.current === requestedInputKey)
          activeInputKey.current = null;
        lastSuccess.current = {
          scope: requestedScope,
          inputKey: requestedInputKey,
          inputs: requestedInputs,
          result,
        };
        setSnapshot({ inputKey: requestedInputKey, status: "success" });
      })
      .catch((requestError: unknown) => {
        if (!lease.isCurrent()) return;
        if (activeInputKey.current === requestedInputKey)
          activeInputKey.current = null;
        const inputDependent =
          requestError instanceof LiveCalculationRequestError &&
          requestError.status === 422;
        const previousInputs =
          lastSuccess.current?.scope === requestedScope
            ? lastSuccess.current.inputs
            : null;
        setSnapshot({
          inputKey: requestedInputKey,
          status: "error",
          ...(inputDependent
            ? {
                diagnosis: diagnoseCalculationInputs(
                  manifest,
                  previousInputs,
                  requestedInputs,
                  requestError.reason,
                ),
              }
            : {}),
          canRetry: !inputDependent,
          error:
            requestError instanceof Error
              ? requestError.message
              : "Live results could not be updated.",
        });
      });
  }, [
    enabled,
    endpoint,
    gate,
    inputKey,
    inputs,
    manifest,
    scope,
    validationKey,
  ]);

  const live = selectLiveCalculationState({
    scope,
    inputKey,
    enabled,
    validationErrors,
    snapshot,
    lastSuccess: lastSuccess.current,
  });

  return { ...live, calculate, retry: calculate };
}
