import "server-only";
import { NextResponse } from "next/server";
import { adminClient, userClient } from "./supabase";
import type { Manifest } from "./types";
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function actor(request?: Request) {
  if (request && !["GET", "HEAD"].includes(request.method)) {
    const expected = new URL(process.env.APP_URL || "http://localhost:3000")
      .origin;
    if (request.headers.get("origin") !== expected)
      throw new ApiError(403, "Invalid request origin.");
  }
  const supabase = await userClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error && process.env.DEBUG_AUTH_ERRORS === "true")
    console.error(
      JSON.stringify({
        event: "auth_error",
        code: error.code ?? null,
        status: error.status ?? null,
      }),
    );
  if (error || !user) throw new ApiError(401, "Please sign in.");
  return { user, db: adminClient() };
}
export async function manifestFor(id: string, version?: string) {
  const db = adminClient();
  let v = version;
  if (!v) {
    const { data } = await db
      .from("calculators")
      .select("current_version")
      .eq("id", id)
      .single();
    v = data?.current_version;
  }
  if (!v) throw new ApiError(404, "Calculator not found.");
  const { data, error } = await db
    .from("calculator_versions")
    .select("manifest,approved")
    .eq("calculator_id", id)
    .eq("version", v)
    .single();
  if (error || !data) throw new ApiError(404, "Calculator version not found.");
  return {
    manifest: data.manifest as Manifest,
    approved: data.approved as boolean,
  };
}
export { publicManifest } from "./public-manifest";
export async function body(request: Request) {
  const text = await request.text();
  if (text.length > 200000) throw new ApiError(413, "Request too large.");
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(400, "Invalid request.");
  }
}
export function dbError(message: string) {
  const messages: Record<string, [number, string]> = {
    SUBSCRIPTION_REQUIRED: [402, "An active subscription is required."],
    REVISION_CONFLICT: [
      409,
      "This calculation changed in another window. Reload before saving.",
    ],
    NOT_FOUND: [404, "Calculation not found."],
    MODEL_REVIEW_REQUIRED: [
      409,
      "This calculator is awaiting model approval. Your inputs are saved.",
    ],
    RUN_IN_PROGRESS: [409, "You already have a calculation running."],
    IDEMPOTENCY_CONFLICT: [409, "This submission key has already been used."],
  };
  const found = Object.keys(messages).find((k) => message.includes(k));
  if (found) throw new ApiError(...messages[found]);
  throw new ApiError(500, "The request could not be completed.");
}
export function failure(error: unknown) {
  if (error instanceof ApiError)
    return NextResponse.json(
      { error: error.message },
      { status: error.status },
    );
  if (error instanceof Error && error.message === "bad")
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  if (error instanceof Error && error.message === "SERVICE_NOT_CONFIGURED")
    return NextResponse.json(
      { error: "Account services are not configured yet." },
      { status: 503 },
    );
  console.error(
    JSON.stringify({
      event: "request_failed",
      kind: error instanceof Error ? error.name : "unknown",
    }),
  );
  return NextResponse.json(
    { error: "Something went wrong. Please try again." },
    { status: 500 },
  );
}
