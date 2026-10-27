import test from "node:test";
import assert from "node:assert/strict";
import {publicManifest} from "../lib/public-manifest";
import {parseLiveResult} from "../lib/evaluation";
import {requestLiveCalculation} from "../lib/live-calculation";
import type {Manifest} from "../lib/types";

const spec = {id:"recoverable",group:"reservoir",label:"Recoverable volume",unit:"m³",cell:"C2"};
const model = {id:"test",version:"2.1.0-candidate.1",name:"Fixture",description:"Fixture",releaseStatus:"review_required",
  groups:[{id:"reservoir",name:"Reservoir"}],fields:[],outputs:["Annual OUTPUT"],inputFeedback:[spec]} as unknown as Manifest;
const feedback = {id:spec.id,group:spec.group,label:spec.label,unit:spec.unit,value:42,format:"#,##0.0"};
const result = {calculatorId:model.id,calculatorVersion:model.version,durationSeconds:1,
  outputSheets:[{name:"Annual OUTPUT",rows:[]}],inputFeedback:[{...feedback,cell:"PRIVATE",formula:"SECRET"}]};

test("interim metadata and returned values do not expose source cells or formulas", async () => {
  assert.deepEqual(publicManifest(model).inputFeedback,[{id:spec.id,group:spec.group,label:spec.label,unit:spec.unit}]);
  assert.deepEqual(parseLiveResult(result,model).inputFeedback,[feedback]);
  const fetcher = (async () => new Response(JSON.stringify(result))) as typeof fetch;
  const parsed = await requestLiveCalculation(model.id,model.version,{},new AbortController().signal,fetcher);
  assert.deepEqual(parsed.inputFeedback,[feedback]);
});

test("interim results must match the exact immutable allowlist", () => {
  for (const inputFeedback of [[],[feedback,feedback],[{...feedback,id:"private"}],
      [{...feedback,value:Infinity}],[{...feedback,group:"unknown"}]])
    assert.throws(() => parseLiveResult({...result,inputFeedback},model));
  assert.throws(() => parseLiveResult({...result,inputFeedback:undefined},model));
  assert.doesNotThrow(() => parseLiveResult({...result,inputFeedback:undefined},{...model,inputFeedback:undefined}));
});
