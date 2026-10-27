import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const admin="10000000-0000-4000-8000-000000000001", outsider="10000000-0000-4000-8000-000000000002";
const upload="20000000-0000-4000-8000-000000000001", token="30000000-0000-4000-8000-000000000001";
const sourceSha="a".repeat(64), runtimeSha="b".repeat(64);

test("model preparation fences steps and atomically approves only the exact reviewed candidate", async () => {
  const db=new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth; create table auth.users(id uuid primary key,email_confirmed_at timestamptz);
      create table app_administrators(user_id uuid primary key);
      create table calculators(id text primary key,name text,description text,current_version text);
      create table calculator_versions(calculator_id text,version text,manifest jsonb,template_path text,template_sha256 text,approved boolean,approved_at timestamptz,primary key(calculator_id,version));
      create table model_uploads(id uuid primary key,calculator_id text,version text,base_version text,status text,sha256 text);
      insert into auth.users values('${admin}',now()),('${outsider}',now());insert into app_administrators values('${admin}');
      insert into calculators values('demo','Demo','Original','1.0');
      insert into calculator_versions values('demo','1.0','{}','original','${sourceSha}',true,now());
      insert into model_uploads values('${upload}','demo','upload-test','1.0','review_required','${sourceSha}');`);
    await db.exec(await fs.readFile(new URL("../supabase/migrations/006_model_preparation.sql",import.meta.url),"utf8"));
    await assert.rejects(db.query("select claim_model_preparation($1,$2,$3)",[upload,outsider,token]),/ADMIN_REQUIRED/);
    const claimed=(await db.query<any>("select claim_model_preparation($1,$2,$3) p",[upload,admin,token])).rows[0].p;
    const version=claimed.candidate_version;
    assert.equal(claimed.phase,"analyze");
    assert.equal((await db.query<any>("select claim_model_preparation($1,$2,$3) p",[upload,admin,outsider])).rows[0].p,null);
    const manifest={id:"demo",version,name:"Demo updated",description:"Updated",sourceSha256:sourceSha,runtimeSha256:runtimeSha};
    const path=`demo/${version}/${runtimeSha}.xlsx`;
    const finish=async(outcome:string,data:unknown,lease=token)=>(await db.query<any>("select finish_model_preparation($1,$2,$3,$4,$5::jsonb) ok",[upload,admin,lease,outcome,JSON.stringify(data)])).rows[0].ok;
    assert.equal(await finish("analyzed",{},outsider),false);
    assert.equal(await finish("analyzed",{manifest,mappingReport:{issues:[]},runtimePath:path,runtimeSha256:runtimeSha,scenarios:[{name:"Changed case",changes:{A1:2}}]}),true);
    const approve=()=>db.query<any>("select approve_model_preparation($1,$2,1,$3,'1.0',true,'Reviewed') result",[upload,admin,reviewHash]);
    let reviewHash="not-ready";
    await assert.rejects(approve(),/PREPARATION_CONFLICT|REVIEW_REQUIRED/);
    const claim=()=>db.query("select claim_model_preparation($1,$2,$3)",[upload,admin,token]);
    await claim();await finish("baseline",{check:{passed:true},result:{summary:[]}});
    await claim();await finish("scenario",{index:0,check:{passed:true,name:"Changed case"}});
    await claim();await finish("complete",{reset:{passed:true},export:{passed:true},exportPath:"review.xlsx",limitations:["Fresh Excel scenario parity unverified"]});
    const ready=(await db.query<any>("select * from model_preparations where upload_id=$1",[upload])).rows[0];
    reviewHash=ready.review_hash;
    assert.equal(ready.state,"ready");
    assert.equal((await db.query<any>("select current_version from calculators")).rows[0].current_version,"1.0");
    await assert.rejects(approve(),/PREPARATION_IDENTITY/);
    await db.query("insert into calculator_versions values('demo',$1,$2::jsonb,$3,$4,false,null)",[version,JSON.stringify(manifest),path,runtimeSha]);
    await assert.rejects(db.query("select approve_model_preparation($1,$2,1,$3,'1.0',false,'')",[upload,admin,reviewHash]),/REVIEW_REQUIRED/);
    await assert.rejects(db.query("select approve_model_preparation($1,$2,1,$3,'older',true,'')",[upload,admin,reviewHash]),/ACTIVE_MODEL_CHANGED/);
    await assert.rejects(db.query("select approve_model_preparation($1,$2,1,'stale','1.0',true,'')",[upload,admin]),/PREPARATION_CONFLICT/);
    const result=(await approve()).rows[0].result;
    assert.equal(result.currentVersion,version);assert.equal(result.replayed,false);
    assert.equal((await approve()).rows[0].result.replayed,true);
    assert.equal((await db.query<any>("select approved from calculator_versions where version=$1",[version])).rows[0].approved,true);
    assert.equal((await db.query<any>("select approved_by from model_preparations")).rows[0].approved_by,admin);
    assert.equal((await db.query<any>("select template_path from calculator_versions where version='1.0'")).rows[0].template_path,"original");
    await assert.rejects(db.query("select revise_model_preparation($1,$2,1,'{}')",[upload,admin]),/PREPARATION_BUSY/);
    await db.exec("set role authenticated");
    await assert.rejects(db.query("select * from model_preparations"),/permission denied/);
    await assert.rejects(db.query("select claim_model_preparation($1,$2,$3)",[upload,admin,token]),/permission denied/);
  } finally {await db.close();}
});

test("revising a mapping invalidates old reports and late workers",async()=>{
  const db=new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
      create table auth.users(id uuid primary key,email_confirmed_at timestamptz);create table app_administrators(user_id uuid primary key);
      create table calculators(id text primary key,name text,description text,current_version text);
      create table calculator_versions(calculator_id text,version text,manifest jsonb,template_path text,template_sha256 text,approved boolean,approved_at timestamptz);
      create table model_uploads(id uuid primary key,calculator_id text,version text,base_version text,status text,sha256 text);
      insert into auth.users values('${admin}',now());insert into app_administrators values('${admin}');
      insert into model_uploads values('${upload}','demo','upload','1.0','review_required','${sourceSha}');`);
    await db.exec(await fs.readFile(new URL("../supabase/migrations/006_model_preparation.sql",import.meta.url),"utf8"));
    await db.query("select claim_model_preparation($1,$2,$3)",[upload,admin,token]);
    await assert.rejects(db.query("select revise_model_preparation($1,$2,1,'{}')",[upload,admin]),/PREPARATION_BUSY/);
    await db.query("update model_preparations set lease_until=now()-interval '1 second' where upload_id=$1",[upload]);
    const revised=(await db.query<any>("select revise_model_preparation($1,$2,1,'{}') p",[upload,admin])).rows[0].p;
    assert.equal(revised.revision,2);assert.equal(revised.review_hash,null);assert.match(revised.candidate_version,/-r2$/);
    assert.equal((await db.query<any>("select finish_model_preparation($1,$2,$3,'failed','{}') ok",[upload,admin,token])).rows[0].ok,false);
    await assert.rejects(db.query("select revise_model_preparation($1,$2,1,'{}')",[upload,admin]),/PREPARATION_CONFLICT/);
  }finally{await db.close();}
});
