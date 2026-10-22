import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { canonicalPageUrl } from "@/lib/canonical-page";

// Keep the unfinished homepage out of the public entry flow for now.
export default async function HomePage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const search = await searchParams;
  const query = new URLSearchParams();
  // Preserve existing authentication errors and selected-plan links.
  if (search.error === "auth") query.set("error", "auth");
  if (search.plan === "month" || search.plan === "year") query.set("plan", search.plan);
  const destination = "/signin" + (query.size ? "?" + query.toString() : "");
  const canonical = canonicalPageUrl(destination, (await headers()).get("host"), process.env.APP_URL, process.env.NODE_ENV === "production");
  redirect(canonical || destination);
}
