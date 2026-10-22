import { adminActor } from "@/lib/admin";
import { ApiError, failure, ok } from "../../../../_route";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { db } = await adminActor(request);
    const { id: calculatorId } = await context.params;
    const body = await request.json();
    const version = typeof body?.version === "string" ? body.version : "";
    const expectedCurrentVersion =
      typeof body?.expectedCurrentVersion === "string"
        ? body.expectedCurrentVersion
        : "";
    if (!version || !expectedCurrentVersion || version.startsWith("upload-"))
      throw new ApiError(
        400,
        "A reviewed calculator version and expected current version are required.",
      );

    const { data: target, error: targetError } = await db
      .from("calculator_versions")
      .select("version,approved,manifest")
      .eq("calculator_id", calculatorId)
      .eq("version", version)
      .single();
    if (targetError || !target || !target.approved)
      throw new ApiError(
        409,
        "That calculator version is not approved for activation.",
      );

    const manifest = target.manifest as Record<string, unknown> | null;
    if (
      !manifest ||
      manifest.id !== calculatorId ||
      manifest.version !== version ||
      typeof manifest.name !== "string" ||
      !manifest.name.trim() ||
      typeof manifest.description !== "string" ||
      !manifest.description.trim()
    )
      throw new ApiError(
        409,
        "That calculator version has invalid catalog metadata.",
      );

    const { data: calculator, error } = await db
      .from("calculators")
      .update({
        current_version: version,
        name: manifest.name,
        description: manifest.description,
      })
      .eq("id", calculatorId)
      .eq("current_version", expectedCurrentVersion)
      .select("id,name,description,current_version")
      .maybeSingle();
    if (error) throw new Error("activation failed");
    if (!calculator)
      throw new ApiError(
        409,
        "The calculator changed in another window. Reload and try again.",
      );

    return ok({
      calculator: {
        id: calculator.id,
        name: calculator.name,
        currentVersion: calculator.current_version,
      },
    });
  } catch (e) {
    return failure(e);
  }
}
