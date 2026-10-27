import { engineEndpoint } from "./evaluation";

export class PreparationEngineError extends Error {
  constructor(readonly retryable: boolean) {
    super("Preparation service unavailable");
  }
}

// Both actions are internal constants. Browser input never supplies an engine
// URL, storage path, manifest, actor identity, or service credential.
export async function preparationEngine(
  action: "prepare" | "review",
  payload: object,
  options: {
    url?: string;
    secret?: string;
    development?: boolean;
    fetcher?: typeof fetch;
  },
) {
  if (!options.secret) throw new PreparationEngineError(true);
  let endpoint: string;
  try {
    endpoint = engineEndpoint(options.url, options.development, action);
  } catch {
    throw new PreparationEngineError(true);
  }
  let response: Response;
  try {
    response = await (options.fetcher ?? fetch)(endpoint, {
      method: "POST",
      redirect: "manual",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        "X-GeoFlow-Engine-Secret": options.secret,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(95_000),
    });
  } catch {
    throw new PreparationEngineError(true);
  }
  if (!response.ok)
    throw new PreparationEngineError(
      response.status !== 422 && response.status !== 400,
    );
  try {
    const text = await response.text();
    if (text.length > 2_000_000) throw new Error();
    return JSON.parse(text) as unknown;
  } catch {
    throw new PreparationEngineError(true);
  }
}
