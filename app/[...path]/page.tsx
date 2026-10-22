import { Suspense } from "react";
import LoadingSpinner from "../LoadingSpinner";
import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { canonicalPageUrl } from "@/lib/canonical-page";
import App from "../WorkspaceApp";
import { parsePageRoute } from "@/lib/routes";

export default async function WorkspacePage({ params, searchParams }: {
  params: Promise<{ path: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { path } = await params;
  const search = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    if (Array.isArray(value)) notFound();
    if (value) query.set(key, value);
  }
  const route = parsePageRoute("/" + path.join("/"), query.toString());
  if (!route) notFound();
  if (!route.preview) {
    const destination = "/" + path.join("/") + (query.size ? "?" + query.toString() : "");
    const canonical = canonicalPageUrl(destination, (await headers()).get("host"), process.env.APP_URL, process.env.NODE_ENV === "production");
    if (canonical) redirect(canonical);
  }
  return <Suspense fallback={<LoadingSpinner fullPage />}><App preview={route.preview} /></Suspense>;
}

