import { actor, failure, manifestFor, ok } from "../../_route";
import { publicManifest } from "@/lib/server";
import { isAdministrator } from "@/lib/admin";
import { ApiError } from "@/lib/server";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const account = await actor(request);
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const result = await manifestFor(
      id,
      searchParams.get("version") ?? undefined,
    );
    if (!result.approved && result.manifest.version.startsWith("release-") && !(await isAdministrator(account.db, account.user)))
      throw new ApiError(404, "Calculator version not found.");
    return ok({
      manifest: publicManifest(result.manifest),
      approved: result.approved,
    });
  } catch (e) {
    return failure(e);
  }
}
