import test from "node:test";
import assert from "node:assert/strict";
import { previewManifest } from "../app/preview/manifest";
import { publicManifest } from "../lib/public-manifest";
import { modelGuide } from "../lib/model-guide";
import type { Manifest } from "../lib/types";

test("guide separates broad section advice from specific input instructions", () => {
  const safe=publicManifest(previewManifest as unknown as Manifest);
  assert.equal(safe.fields.length,195);
  const reservoir=safe.fields.filter(f=>f.group==="reservoir");
  assert.equal(reservoir.length,23);
  assert.equal(reservoir.some(f=>f.help),false);
  assert.match(safe.groups.find(g=>g.id==="reservoir")!.help!.body,/Primary Fluid & Reservoir Parameters/);
  assert.match(safe.groups.find(g=>g.id==="reservoir")!.help!.body,/Production Forecast Parameters/);
  const notes=safe.fields.filter(f=>f.help);
  assert.equal(notes.length,172);
  const discount=safe.fields.find(f=>f.label==="Discount rate")!;
  assert.equal(discount.help!.title,"Discount rate");
  assert.match(discount.help!.body,/0\.15 represents 15%/);
  const acquisition=notes.filter(f=>f.label==="Seismic acquisition spending");
  assert.equal(acquisition.length,3);
  assert.notEqual(acquisition[0].help!.title,acquisition[1].help!.title);
  assert.match(acquisition[0].help!.body,/USD MM, not whole USD/);
  for (const field of safe.fields) {
    const preview=previewManifest.fields.find(f=>f.id===field.id)!;
    assert.deepEqual(field.help,"help" in preview?preview.help:undefined);
    assert.equal(field.default,preview.default);
    assert.equal(field.type,preview.type);
  }
});

test("guide correction leaves other released models untouched",()=>{
  const fallback={title:"Original",body:"Original note"};
  assert.deepEqual(modelGuide("other","2.0.0-candidate.1","fields","x",fallback),fallback);
  assert.deepEqual(modelGuide("state-rent","1.0.0-candidate.1","fields","x",fallback),fallback);
});
