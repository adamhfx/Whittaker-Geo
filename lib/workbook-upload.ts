import { unzipSync } from "fflate";
import { XMLParser } from "fast-xml-parser";
import type { Manifest } from "./types";

export const MAX_WORKBOOK_BYTES = 20 * 1024 * 1024;
const MAX_ENTRIES = 2_000;
const MAX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;
const MAX_ENTRY_BYTES = 25 * 1024 * 1024;
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", processEntities: false, removeNSPrefix: true });

export type WorkbookValidation = { checks: string[]; warnings: string[] };

function text(bytes: Uint8Array) { return new TextDecoder().decode(bytes); }
function asArray<T>(value: T | T[] | undefined): T[] { return value === undefined ? [] : Array.isArray(value) ? value : [value]; }

function preflightZip(buffer: Uint8Array) {
  if (buffer.byteLength < 22) throw new Error("The workbook is not a valid XLSX file.");
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  let eocd = -1;
  for (let i = buffer.byteLength - 22; i >= Math.max(0, buffer.byteLength - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("The workbook is not a valid XLSX file.");
  const count = view.getUint16(eocd + 10, true), centralSize = view.getUint32(eocd + 12, true), centralOffset = view.getUint32(eocd + 16, true);
  if (!count || count > MAX_ENTRIES || centralOffset + centralSize > buffer.byteLength) throw new Error("Workbook ZIP structure is unsafe.");
  let cursor = centralOffset, total = 0;
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > buffer.byteLength || view.getUint32(cursor, true) !== 0x02014b50) throw new Error("Workbook ZIP structure is unsafe.");
    const compressed = view.getUint32(cursor + 20, true), uncompressed = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true), extraLength = view.getUint16(cursor + 30, true), commentLength = view.getUint16(cursor + 32, true);
    const end = cursor + 46 + nameLength + extraLength + commentLength;
    if (end > buffer.byteLength || uncompressed > MAX_ENTRY_BYTES || (total += uncompressed) > MAX_UNCOMPRESSED_BYTES || (compressed && uncompressed / compressed > 100)) throw new Error("Workbook ZIP structure is too large.");
    const name = new TextDecoder().decode(buffer.subarray(cursor + 46, cursor + 46 + nameLength));
    if (name.startsWith("/") || name.split("/").includes("..") || name.includes("\\")) throw new Error("Workbook contains an unsafe ZIP path.");
    const lower = name.toLowerCase();
    if (lower.includes("vbaproject") || lower.includes("/embeddings/") || /\.(exe|dll|js|vbs|bat|cmd|ps1)$/i.test(name)) throw new Error("Macros and executable workbook content are not allowed.");
    cursor = end;
  }
}

function partPath(target: string) {
  if (target.startsWith("/")) return target.slice(1);
  const parts = `xl/${target}`.split("/"); const out: string[] = [];
  for (const part of parts) { if (!part || part === ".") continue; if (part === "..") out.pop(); else out.push(part); }
  return out.join("/");
}

export function validateWorkbook(buffer: Uint8Array, manifest?: Partial<Manifest> | null): WorkbookValidation {
  if (buffer.byteLength > MAX_WORKBOOK_BYTES) throw new Error("Workbook exceeds the 20 MB limit.");
  preflightZip(buffer);
  let files: Record<string, Uint8Array>;
  try { files = unzipSync(buffer); } catch { throw new Error("The workbook is not a valid XLSX file."); }
  const names = Object.keys(files);
  if (!names.length || names.length > MAX_ENTRIES) throw new Error("Workbook ZIP structure is unsafe.");
  for (const name of names) {
    const bytes = files[name];
    if (/\.xml$|\.rels$/i.test(name) && /<!DOCTYPE|<!ENTITY/i.test(text(bytes))) throw new Error("Workbook XML declarations are not allowed.");
  }
  if (!files["[Content_Types].xml"] || !files["xl/workbook.xml"] || !files["xl/_rels/workbook.xml.rels"]) throw new Error("Workbook is missing required XLSX parts.");
  const relsXml = text(files["xl/_rels/workbook.xml.rels"]);
  const relParsed = parser.parse(relsXml);
  for (const name of names.filter((n) => n.toLowerCase().endsWith(".rels"))) {
    const parsed = parser.parse(text(files[name]));
    if ((asArray(parsed?.Relationships?.Relationship) as Array<Record<string, string>>).some((rel) => String(rel["@_TargetMode"] ?? "").toLowerCase() === "external")) throw new Error("External workbook relationships are not allowed.");
  }
  const workbookXml = text(files["xl/workbook.xml"]);
  const workbook = parser.parse(workbookXml);
  const sheets = asArray(workbook?.workbook?.sheets?.sheet) as Array<Record<string, string>>;
  const sheetNames = sheets.map((s) => s["@_name"]).filter(Boolean);
  const outputs = manifest?.outputs;
  const outputNames = Array.isArray(outputs) ? outputs : outputs?.views.map((view) => view.sheet) ?? [];
  const inputName = manifest?.inputSheet || "Inputs";
  const missingOutputs = outputNames.filter((name) => !sheetNames.includes(name));
  if (!sheetNames.includes(inputName) || missingOutputs.length) throw new Error("Workbook is missing required input or output sheets.");
  const warnings: string[] = [];
  if (names.some((n) => n.startsWith("xl/externalLinks/"))) warnings.push("Workbook contains broken external references that require review.");
  const relById = new Map<string, string>();
  for (const rel of asArray(relParsed?.Relationships?.Relationship) as Array<Record<string, string>>) relById.set(rel["@_Id"], rel["@_Target"]);
  const inputSheet = sheets.find((s) => s["@_name"] === inputName);
  const inputTarget = inputSheet ? relById.get(inputSheet["@_r:id"] || inputSheet["@_id"]) : undefined;
  const inputPath = inputTarget ? partPath(inputTarget) : undefined;
  if (!inputPath || !files[inputPath]) throw new Error("Workbook is missing the configured input worksheet part.");
  const inputXml = text(files[inputPath]);
  const cells = new Map<string, Record<string, unknown>>();
  const inputDocument = parser.parse(inputXml);
  for (const row of asArray(inputDocument?.worksheet?.sheetData?.row)) {
    for (const cell of asArray(row?.c)) {
      if (typeof cell?.["@_r"] === "string") cells.set(cell["@_r"].toUpperCase(), cell);
    }
  }
  const fields = manifest?.fields ?? [];
  let missing = 0;
  for (const field of fields) {
    const cell = typeof field.cell === "string" ? field.cell.toUpperCase() : "";
    if (!cell) continue;
    const body = cells.get(cell);
    if (body === undefined) { if (field.required && !field.blankOnNew) missing++; }
    else if (Object.hasOwn(body, "f")) throw new Error("Mapped input cells must not contain formulas.");
  }
  if (missing) throw new Error("Workbook is missing required mapped input cells.");
  return {
    checks: ["XLSX ZIP structure accepted", "Macros and external executable content rejected", "Inputs and configured output sheets present", ...(fields.length ? ["Mapped input cells checked", "Mapped input formulas rejected"] : [])],
    warnings,
  };
}

export function draftVersion(id = crypto.randomUUID(), date = new Date()) {
  const stamp = date.toISOString().slice(0, 10).replaceAll("-", "");
  return `upload-${stamp}-${id}`;
}
