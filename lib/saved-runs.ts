/** Enable queued runs only after a saved-run worker has been provisioned. */
export function savedRunsEnabled(value = process.env.SAVED_RUNS_ENABLED): boolean {
  return value === "true";
}
