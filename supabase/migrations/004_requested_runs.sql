begin;

-- Request-driven execution shares the existing queue with the optional worker.
-- Only the server role may claim or publish; a lease fences duplicate requests.
create function public.claim_requested_run(p_user uuid,p_run uuid,p_token uuid)
returns boolean language plpgsql security definer set search_path=public as $$
declare j jobs; r runs;
begin
 select * into j from jobs where run_id=p_run and exists
   (select 1 from runs where id=p_run and user_id=p_user) for update;
 if not found then raise exception 'NOT_FOUND'; end if;
 select * into r from runs where id=p_run and user_id=p_user for update;
 if r.status in ('succeeded','failed') then return false; end if;
 if j.state='running' and j.lease_until>now() then return false; end if;
 if j.available_at>now() then return false; end if;
 if j.attempts>=2 then
   update jobs set state='failed',worker_id=null,lease_token=null,lease_until=null where id=j.id;
   update runs set status='failed',error_code='LEASE_EXPIRED',finished_at=now() where id=r.id;
   return false;
 end if;
 if not exists(select 1 from calculator_versions where calculator_id=r.calculator_id
     and version=r.calculator_version and approved) then
   update jobs set state='failed' where id=j.id;
   update runs set status='failed',error_code='MODEL_REVIEW_REQUIRED',finished_at=now() where id=r.id;
   return false;
 end if;
 update jobs set state='running',attempts=attempts+1,worker_id='on-demand',
   lease_token=p_token,lease_until=now()+interval '180 seconds' where id=j.id;
 update runs set status='running',started_at=coalesce(started_at,now()),error_code=null where id=r.id;
 return true;
end;$$;

create function public.finish_requested_run(p_user uuid,p_run uuid,p_token uuid,
  p_outcome text,p_export text default null,p_result jsonb default null)
returns boolean language plpgsql security definer set search_path=public as $$
declare j jobs; r runs;
begin
 select * into j from jobs where run_id=p_run and exists
   (select 1 from runs where id=p_run and user_id=p_user) for update;
 if not found then raise exception 'NOT_FOUND'; end if;
 select * into r from runs where id=p_run and user_id=p_user for update;
 if r.status<>'running' or j.state<>'running' or j.lease_token is distinct from p_token
     or j.lease_until is null or j.lease_until<=now() then return false; end if;
 if p_outcome='succeeded' then
   if p_export is distinct from p_user::text||'/'||p_run::text||'/'||p_token::text||'.xlsx'
      or jsonb_typeof(p_result) is distinct from 'object'
      or p_result->>'calculatorId' is distinct from r.calculator_id
      or p_result->>'calculatorVersion' is distinct from r.calculator_version
      or octet_length(p_result::text)>2000000 then raise exception 'INVALID_RESULT'; end if;
   update runs set status='succeeded',result=p_result,export_path=p_export,error_code=null,finished_at=now() where id=r.id;
   update jobs set state='done',worker_id=null,lease_token=null,lease_until=null where id=j.id;
 elsif p_outcome='retry' then
   -- Busy/startup responses did not finish a calculation and do not spend a crash retry.
   update runs set status='queued' where id=r.id;
   update jobs set state='queued',attempts=greatest(0,attempts-1),available_at=now()+interval '5 seconds',
     worker_id=null,lease_token=null,lease_until=null where id=j.id;
 elsif p_outcome='failed' then
   update runs set status='failed',error_code='CALCULATION_FAILED',finished_at=now() where id=r.id;
   update jobs set state='failed',worker_id=null,lease_token=null,lease_until=null where id=j.id;
 else raise exception 'INVALID_OUTCOME'; end if;
 return true;
end;$$;

revoke execute on function public.claim_requested_run(uuid,uuid,uuid),
  public.finish_requested_run(uuid,uuid,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.claim_requested_run(uuid,uuid,uuid),
  public.finish_requested_run(uuid,uuid,uuid,text,text,jsonb) to service_role;
commit;
