import type {OutputCell, OutputSheet} from "./live-calculation";

export type AnnualTable = {
  label: string;
  yearColumn: number;
  columns: {column: number; label: string; unit: string}[];
  groups: {id: string; label: string; columns: number[]}[];
  rows: OutputCell[][];
};

/** Recognize the workbook's year-led annual block without changing any values. */
export function annualTable(sheet: OutputSheet, blockIndex = 0): AnnualTable | null {
  const rows = sheet.rows.map(row => row.cells.filter(cell => cell.value !== null && cell.value !== "")
    .slice().sort((a,b) => a.column-b.column));
  const yearHeading = (value: unknown) => typeof value === "string" && /^year(?:\s*\((?:project|qi)\))?$/i.test(value.trim());
  const headingIndex = rows.findIndex(row => row.some(cell => yearHeading(cell.value)));
  if (headingIndex < 0) return null;
  const yearColumns = rows[headingIndex].filter(cell => yearHeading(cell.value)).map(cell => cell.column);
  const yearColumn = yearColumns[blockIndex];
  if (yearColumn === undefined) return null;
  const end = yearColumns[blockIndex+1] ?? Infinity;
  const start = rows.findIndex((row,index) => index > headingIndex && row.some(cell => cell.column === yearColumn &&
    typeof cell.value === "number" && Number.isInteger(cell.value) && cell.value >= 0 && cell.value <= 1000));
  if (start < 0) return null;
  let lastYear = start;
  rows.forEach((row,index) => {if (index >= start && row.some(cell => cell.column === yearColumn &&
    typeof cell.value === "number" && Number.isInteger(cell.value) && cell.value >= 0 && cell.value <= 1000)) lastYear=index;});
  // A source may include a totals row after a blank separator. Do not pull
  // unrelated financial analysis farther down the worksheet into the table.
  let finalRow = lastYear;
  for (let index=lastYear+1; index<Math.min(rows.length,lastYear+4); index++) {
    const cells=rows[index].filter(cell=>cell.column>=yearColumn && cell.column<end);
    if (!cells.length) continue;
    if (cells.every(cell=>typeof cell.value === "number")) finalRow=index;
    break;
  }
  const body = rows.slice(start,finalRow+1).map(row => row.filter(cell => cell.column >= yearColumn && cell.column < end)).filter(row => row.length);
  const columns = Array.from(new Set(body.flatMap(row => row.map(cell => cell.column)))).sort((a,b) => a-b);
  const headings = rows.slice(headingIndex+1,start);
  const descriptors = columns.map(column => {
    const parts = headings.flatMap(row => row.filter(cell => cell.column === column && typeof cell.value === "string")
      .map(cell => String(cell.value).trim()).filter(Boolean));
    return {column,label: column === yearColumn ? "Year" : parts[0] ?? `Result ${column}`,
      unit:column === yearColumn ? "" : parts.slice(1).join(" · ")};
  });
  const groups = rows[headingIndex].filter(cell => cell.column > yearColumn && cell.column < end && typeof cell.value === "string")
    .map((cell,index,labels) => ({id:String(cell.column),label:String(cell.value),
      columns:columns.filter(column => column >= cell.column && column < (labels[index+1]?.column ?? end))}));
  const yearTitle=String(rows[headingIndex].find(cell=>cell.column===yearColumn)?.value ?? "Year");
  const label=/\(Qi\)/i.test(yearTitle) ? "Type-well production profile"
    : /\(Project\)/i.test(yearTitle) ? "Field production forecast" : "Annual cash flow";
  return {label,yearColumn,columns:descriptors,groups:groups.filter(group => group.columns.length),rows:body};
}

export function annualTables(sheet: OutputSheet): AnnualTable[] {
  const headings=sheet.rows.find(row=>row.cells.some(cell=>typeof cell.value === "string" && /^year(?:\s*\((?:project|qi)\))?$/i.test(cell.value.trim())));
  const count=headings?.cells.filter(cell=>typeof cell.value === "string" && /^year(?:\s*\((?:project|qi)\))?$/i.test(cell.value.trim())).length ?? 0;
  return Array.from({length:count},(_,index)=>annualTable(sheet,index)).filter((value):value is AnnualTable=>value !== null);
}
