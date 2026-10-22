import { actor, failure, ok } from "../_route";
import { DISPLAY_PRICES, billingEnabled } from "@/lib/billing";
import { paidAccess } from "@/lib/validation";
import { isAdministrator } from "@/lib/admin";
import { savedRunsEnabled } from "@/lib/saved-runs";
export async function GET(request: Request) {
  try {
    const { user, db } = await actor(request);
    const [{ data: sub }, { data: calculators }, { data: calculations }] =
      await Promise.all([
        db
          .from("subscriptions")
          .select("status,paid_until,interval,cancel_at_period_end")
          .eq("user_id", user.id)
          .maybeSingle(),
        db
          .from("calculators")
          .select("id,name,description,current_version")
          .order("name"),
        db
          .from("calculations")
          .select("*")
          .eq("user_id", user.id)
          .order("updated_at", { ascending: false }),
      ]);
    const subscription = sub ?? null;
    return ok({
      user: {
        id: user.id,
        email: user.email,
        isAdmin: await isAdministrator(db, user),
        name:
          typeof user.user_metadata?.full_name === "string"
            ? user.user_metadata.full_name
            : null,
        avatarUrl:
          typeof user.user_metadata?.avatar_url === "string" &&
          /^https:\/\//.test(user.user_metadata.avatar_url)
            ? user.user_metadata.avatar_url
            : null,
      },
      subscription,
      canWrite: paidAccess(subscription),
      calculators: calculators ?? [],
      calculations: calculations ?? [],
      billingEnabled: billingEnabled(),
      savedRunsEnabled: savedRunsEnabled(),
      prices: DISPLAY_PRICES,
    });
  } catch (e) {
    return failure(e);
  }
}
