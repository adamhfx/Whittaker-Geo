import test from "node:test";
import assert from "node:assert/strict";
import {annualTable,annualTables} from "../lib/output-table";
const row = (...values:[number,string|number][]) => ({cells:values.map(([column,value])=>({column,value}))});

test("annual headings and column groups retain numeric values and skip unrelated source blocks",()=>{
  const table=annualTable({name:"Annual OUTPUT",rows:[row([1,"Scenario multipliers"]),
    row([14,"Year"],[15,"Revenue"],[17,"Capex"],[22,"Year (Qi)"]),
    row([15,"Gas production"],[16,"Gas price"],[17,"Drilling"],[22,"Forecast year"]),
    row([15,"m³"],[16,"$/m³"],[17,"USD"]),row([14,0],[15,0],[16,0.45],[17,5],[22,1]),
    row([14,1],[15,123],[16,0.46],[17,10],[22,2]),row([14,"Unrelated analysis"],[15,999]) ]});
  assert.ok(table);
  assert.equal(table.yearColumn,14);
  assert.deepEqual(table.columns.map(column=>column.label),["Year","Gas production","Gas price","Drilling"]);
  assert.equal(table.columns[1].unit,"m³");
  assert.deepEqual(table.groups.map(group=>group.columns),[[15,16],[17]]);
  assert.equal(table.rows[1][1].value,123);
  assert.equal(table.rows[0][2].value,0.45);
  assert.equal(table.rows.length,2);
});

test("unrecognized legacy layouts retain the unmodified raw output table",()=>{
  assert.equal(annualTable({name:"Other OUTPUT",rows:[row([1,"NPV"],[2,100])]}),null);
  assert.equal(annualTable({name:"Empty OUTPUT",rows:[]}),null);
});

test("legacy field and type-well blocks keep distinct labels and columns",()=>{
  const blocks=annualTables({name:"Legacy OUTPUT",rows:[
    row([1,"Year"],[4,"Year (Project)"],[8,"Year (Qi)"]),
    row([2,"Cash flow"],[5,"Field gas"],[9,"Well gas"]),
    row([2,"USD"],[5,"m³"],[9,"m³"]),
    row([1,1],[2,10],[4,1],[5,20],[8,1],[9,30])
  ]});
  assert.deepEqual(blocks.map(block=>block.label),["Annual cash flow","Field production forecast","Type-well production profile"]);
  assert.deepEqual(blocks.map(block=>block.rows[0].map(cell=>cell.value)),[[1,10],[1,20],[1,30]]);
});
