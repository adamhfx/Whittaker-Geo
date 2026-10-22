import { redirect } from "next/navigation";

// Keep the unfinished homepage out of the public entry flow for now.
export default async function HomePage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const search = await searchParams;
  const query = new URLSearchParams();
  // Preserve existing authentication errors and selected-plan links.
  if (search.error === "auth") query.set("error", "auth");
  if (search.plan === "month" || search.plan === "year") query.set("plan", search.plan);
  redirect("/signin" + (query.size ? "?" + query.toString() : ""));
}
