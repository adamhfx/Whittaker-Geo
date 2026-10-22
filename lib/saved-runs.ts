/** Enable after the request-driven engine and durable publication functions are deployed. */
export function savedRunsEnabled(value = process.env.SAVED_RUNS_ENABLED): boolean {
  return value === "true";
}
