export type InputValues = Record<string, string | number | null>;
export type HelpNote = { title: string; body: string };
export type OutputView = { id: string; name: string; sheet: string };
export type Field = {
  id: string;
  cell: string;
  label: string;
  unit: string;
  group: string;
  type: string;
  default: string | number | null;
  required: boolean;
  blankOnNew: boolean;
  options?: string[];
  year?: number;
  scheduleRow?: number;
  help?: HelpNote;
  role?: string;
  dependsOn?: string;
  optionsByDependencyValue?: Record<string, string[]>;
  optionLabels?: Record<string, string>;
  radioGroup?: string;
  min?: number;
  max?: number;
  exclusiveMin?: number;
  exclusiveMax?: number;
  integer?: boolean;
};
export type Manifest = {
  id: string;
  version: string;
  name: string;
  description: string;
  groups: { id: string; name: string; help?: HelpNote }[];
  inputSheet?: string;
  inputRules?: { ascending?: { label: string; fields: string[] }[] };
  outputViews?: OutputView[];
  fields: Field[];
  releaseStatus: string;
  outputs: string[] | { views: { id: string; label: string; sheet: string; sourceRange: string; [key: string]: unknown }[] };
  multipliers: string[];
  runtimeSha256: string;
};
export type Calculation = {
  id: string;
  name: string;
  calculator_id: string;
  calculator_version: string;
  inputs: InputValues;
  revision: number;
  created_at: string;
  updated_at: string;
};
export type Annual = {
  year: number;
  contractor: number;
  contractorCumulative: number;
  state: number;
  stateCumulative: number;
  capex: number;
  opex: number;
  gas: number;
  oil: number;
};
export type Result = {
  metrics: {
    contractorNpv10: number;
    stateNpv10: number;
    contractorCashFlow: number;
    capitalInvestment: number;
    irr: number | null;
    payoutYear: number | null;
  };
  annual: Annual[];
  sensitivity: {
    input: string;
    label: string;
    baseline: number;
    low: number;
    high: number;
  }[];
  calculatorVersion: string;
  durationSeconds: number;
};
export type Run = {
  id: string;
  calculation_id: string;
  calculator_version: string;
  calculation_revision: number;
  status: "queued" | "running" | "succeeded" | "failed";
  inputs: InputValues;
  result: Result | LiveResult | null;
  created_at: string;
  finished_at: string | null;
  error_code: string | null;
};

export type LiveOutputCell = { column: number; value: string | number | null; format?: string };
export type LiveOutputSheet = { name: string; rows: { cells: LiveOutputCell[] }[] };
export type LiveSummaryItem = {
  section?: string;
  label: string;
  value: string | number | null;
  format?: string;
  unit?: string;
};
export type LiveChart = {
  title: string;
  kind: "line" | "column";
  categories: (number | string)[];
  series: { name: string; values: (number | null)[] }[];
};
export type LiveResult = {
  calculatorId: string;
  calculatorVersion: string;
  outputSheets: LiveOutputSheet[];
  durationSeconds: number;
  summary?: LiveSummaryItem[];
  charts?: LiveChart[];
};
