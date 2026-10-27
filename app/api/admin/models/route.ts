import { adminActor } from "@/lib/admin";
import { ApiError, failure, ok } from "../../_route";
import { draftVersion, MAX_WORKBOOK_BYTES, validateWorkbook } from "@/lib/workbook-upload";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const uploadView = (row: any) => ({ id: row.id, version: row.version, fileName: row.file_name, status: row.status, createdAt: row.created_at, notes: row.notes, validation: row.validation });

export async function GET(request: Request) {
  try {
    const { db } = await adminActor(request);
    const [{ data: calculators, error: calculatorError }, { data: versions, error: versionError }, { data: uploads, error: uploadError }, { data: preparations, error: preparationError }] = await Promise.all([
      db.from("calculators").select("id,name,current_version").order("name"),
      db.from("calculator_versions").select("calculator_id,version,approved,created_at" ).order("created_at", { ascending: false }),
      db.from("model_uploads").select("id,calculator_id,version,file_name,status,created_at,notes,validation").order("created_at", { ascending: false }),
      db.from("model_preparations").select("upload_id,state,phase,candidate_version"),
    ]);
    if (calculatorError || versionError || uploadError || preparationError) throw new Error("catalog query failed");
    return ok({ calculators: (calculators ?? []).map((c: any) => ({
      id: c.id, name: c.name, currentVersion: c.current_version,
      versions: (versions ?? []).filter((v: any) => v.calculator_id === c.id).map((v: any) => ({ version: v.version, approved: v.approved, createdAt: v.created_at })),
      uploads: (uploads ?? []).filter((u: any) => u.calculator_id === c.id).map((u: any) => ({ ...uploadView(u), preparation: (preparations ?? []).find((p: any) => p.upload_id === u.id) ?? null })),
    })) });
  } catch (e) { return failure(e); }
}

export async function POST(request: Request) {
  let storagePath: string | undefined;
  try {
    const { user, db } = await adminActor(request);
    const form = await request.formData();
    const calculatorId = String(form.get("calculatorId") ?? "").trim();
    const notes = String(form.get("notes") ?? "");
    const value = form.get("file");
    if (!calculatorId || notes.length > 1000 || !(value instanceof File)) throw new ApiError(400, "A calculator, workbook file, and valid notes are required.");
    if (value.size > MAX_WORKBOOK_BYTES || !value.name.toLowerCase().endsWith(".xlsx") || (value.type && value.type !== XLSX_MIME)) throw new ApiError(415, "Upload an XLSX workbook no larger than 20 MB.");
    const { data: calculator, error: calculatorError } = await db.from("calculators").select("id,current_version").eq("id", calculatorId).single();
    if (calculatorError || !calculator) throw new ApiError(404, "Calculator not found.");
    const { data: baseVersion, error: baseError } = await db.from("calculator_versions").select("manifest").eq("calculator_id", calculatorId).eq("version", calculator.current_version).maybeSingle();
    if (baseError || !baseVersion?.manifest?.fields?.length) throw new ApiError(409, "The current calculator input mapping is unavailable. Please try again after model setup is complete.");
    const bytes = new Uint8Array(await value.arrayBuffer());
    const sha256 = Buffer.from(await crypto.subtle.digest("SHA-256", bytes)).toString("hex");
    const baseVersionName = calculator.current_version;
    const { data: existing } = await db.from("model_uploads").select("id,version,file_name,status,created_at,notes,validation").eq("calculator_id", calculatorId).eq("sha256", sha256).eq("base_version", baseVersionName).maybeSingle();
    if (existing) return ok({ upload: uploadView(existing), duplicate: true });
    let validation;
    // Preparation resolves moved inputs against fixed labels. This initial
    // preflight checks the package/sheets without rejecting old cell positions.
    try { validation = validateWorkbook(bytes, { ...baseVersion.manifest, fields: [] }); }
    catch (error) { throw new ApiError(422, error instanceof Error ? error.message : "The workbook could not be validated."); }
    const id = crypto.randomUUID();
    const version = draftVersion(id);
    storagePath = `admin-uploads/${calculatorId}/${id}.xlsx`;
    const { error: storageError } = await db.storage.from("model-templates").upload(storagePath, bytes, { contentType: XLSX_MIME, upsert: false });
    if (storageError) throw new Error("storage upload failed");
    const { data: row, error: insertError } = await db.from("model_uploads").insert({ id, calculator_id: calculatorId, version, base_version: baseVersionName, storage_path: storagePath, sha256, file_name: value.name.slice(0, 255), notes, status: "review_required", validation, uploaded_by: user.id }).select("id,version,file_name,status,created_at,notes,validation").single();
    if (insertError || !row) throw new Error("upload record failed");
    return ok({ upload: uploadView(row), duplicate: false }, 201);
  } catch (e) {
    // An uncertain insert response may already have committed. Never delete its
    // immutable source; a duplicate upload can recover the published record.
    return failure(e);
  }
}
