import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("requested runs enforce ownership, exclusive leases, recovery and immutable publication", async () => {
  const db = new PGlite();
  const alice="00000000-0000-4000-8000-000000000001", bob="00000000-0000-4000-8000-000000000002";
  const calc="00000000-0000-4000-8000-000000000003", key="00000000-0000-4000-8000-000000000004";
  const first="00000000-0000-4000-8000-000000000005", second="00000000-0000-4000-8000-000000000006";
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select null::uuid$$;
      create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`);
    await db.exec((await readFile("supabase/migrations/001_service.sql","utf8")).replace("create extension if not exists pgcrypto;",""));
    await db.exec(await readFile("supabase/migrations/004_requested_runs.sql","utf8"));
    await db.query("insert into auth.users values($1),($2)",[alice,bob]);
    await db.query("insert into subscriptions(user_id,status,paid_until) values($1,'active',now()+interval '1 day')",[alice]);
    await db.exec(`insert into calculators values('test','Test','Test','v2',now());
      insert into calculator_versions values('test','v2','{}','private/test.xlsx','hash',true,now(),now());`);
    await db.query("select save_calculation($1,$2,'test','v2','Saved','{}',null)",[alice,calc]);
    const id=(await db.query<{id:string}>("select (submit_run($1,$2,1,$3)).id",[alice,calc,key])).rows[0].id;
    const claim=async (user:string,token:string)=> (await db.query<{ok:boolean}>("select claim_requested_run($1,$2,$3) ok",[user,id,token])).rows[0].ok;
    const finish=async (token:string,outcome:string,path:string|null=null,result:unknown=null)=>
      (await db.query<{ok:boolean}>("select finish_requested_run($1,$2,$3,$4,$5,$6) ok",[alice,id,token,outcome,path,result])).rows[0].ok;
    await db.exec("set role authenticated");
    await assert.rejects(claim(alice,first),/permission denied/);
    await db.exec("reset role");
    await assert.rejects(claim(bob,first),/NOT_FOUND/);
    assert.equal(await claim(alice,first),true);
    assert.equal(await claim(alice,second),false);
    assert.equal(await finish(second,"failed"),false);
    assert.equal(await finish(first,"retry"),true);
    assert.equal(await claim(alice,second),false); // five-second backoff
    await db.query("update jobs set available_at=now() where run_id=$1",[id]);
    assert.equal(await claim(alice,first),true);
    await db.query("update jobs set lease_until=now()-interval '1 second' where run_id=$1",[id]);
    assert.equal(await finish(first,"failed"),false);
    assert.equal(await claim(alice,second),true);
    assert.equal(await finish(first,"failed"),false); // recovered lease owns publication
    const result={calculatorId:"test",calculatorVersion:"v2",outputSheets:[]};
    await assert.rejects(finish(second,"succeeded",`${bob}/${id}/${second}.xlsx`,result),/INVALID_RESULT/);
    await assert.rejects(finish(second,"succeeded",`${alice}/${id}/${second}.xlsx`,{...result,calculatorVersion:"v1"}),/INVALID_RESULT/);
    assert.equal(await finish(second,"succeeded",`${alice}/${id}/${second}.xlsx`,result),true);
    assert.equal(await finish(second,"failed"),false);
    assert.equal(await claim(alice,first),false);
    const stored=(await db.query<{status:string,result:unknown}>("select status,result from runs where id=$1",[id])).rows[0];
    assert.equal(stored.status,"succeeded"); assert.deepEqual(stored.result,result);
    await assert.rejects(db.query("update runs set result='{}' where id=$1",[id]),/IMMUTABLE_COMPLETED_RUN/);
  } finally { await db.close(); }
});
