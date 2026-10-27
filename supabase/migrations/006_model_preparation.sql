begin;

create table public.model_preparations (
 upload_id uuid primary key references public.model_uploads(id),
 revision integer not null default 1 check (revision > 0),
 state text not null default 'queued' check (state in ('queued','working','mapping_required','validating','ready','failed','approved')),
 phase text not null default 'analyze' check (phase in ('analyze','baseline','scenario','export','complete')),
 candidate_version text not null,
 mapping jsonb not null default '{}'::jsonb,
 mapping_report jsonb not null default '{}'::jsonb,
 manifest jsonb,
 runtime_path text,
 runtime_sha256 text check (runtime_sha256 is null or runtime_sha256 ~ '^[0-9a-f]{64}$'),
 baseline_result jsonb,
 scenarios jsonb not null default '[]'::jsonb,
 scenario_index integer not null default 0,
 validations jsonb not null default '{}'::jsonb,
 export_path text,
 review_hash text,
 error text,
 lease_token uuid,
 lease_until timestamptz,
 attempts integer not null default 0,
 approved_by uuid references auth.users(id),
 approved_at timestamptz,
 approval_notes text,
 updated_at timestamptz not null default now(),
 check (octet_length(mapping::text) <= 200000),
 check (octet_length(mapping_report::text) <= 1000000),
 check (octet_length(validations::text) <= 2000000)
);
alter table public.model_preparations enable row level security;
revoke all on public.model_preparations from public,anon,authenticated;
grant all on public.model_preparations to service_role;

create function public.claim_model_preparation(p_upload uuid,p_actor uuid,p_token uuid,p_initial_mapping jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare u model_uploads; p model_preparations;
begin
 if not exists(select 1 from app_administrators a join auth.users x on x.id=a.user_id where a.user_id=p_actor and x.email_confirmed_at is not null) then raise exception 'ADMIN_REQUIRED'; end if;
 if jsonb_typeof(p_initial_mapping)<>'object' or octet_length(p_initial_mapping::text)>200000 then raise exception 'INVALID_MAPPING';end if;
 select * into u from model_uploads where id=p_upload for update;
 if not found or u.status<>'review_required' then return null; end if;
 insert into model_preparations(upload_id,candidate_version,mapping) values(p_upload,'release-'||replace(p_upload::text,'-','')||'-r1',p_initial_mapping) on conflict do nothing;
 select * into p from model_preparations where upload_id=p_upload for update;
 if p.state in ('ready','approved','mapping_required','failed') or p.lease_until>now() then return null; end if;
 if p.attempts>=3 then
  update model_preparations set state='failed',error='Preparation was interrupted repeatedly. Retry the checks from this review.',lease_token=null,lease_until=null,updated_at=now() where upload_id=p_upload;
  return null;
 end if;
 update model_preparations set state=case when phase='analyze' then 'working' else 'validating' end,
  lease_token=p_token,lease_until=now()+interval '180 seconds',attempts=attempts+1,error=null,updated_at=now()
  where upload_id=p_upload returning * into p;
 return to_jsonb(p);
end;$$;

create function public.finish_model_preparation(p_upload uuid,p_actor uuid,p_token uuid,p_outcome text,p_data jsonb default '{}'::jsonb)
returns boolean language plpgsql security definer set search_path=public as $$
declare p model_preparations; u model_uploads; v jsonb;
begin
 if not exists(select 1 from app_administrators where user_id=p_actor) then raise exception 'ADMIN_REQUIRED';end if;
 select * into p from model_preparations where upload_id=p_upload for update;
 if not found or p.lease_token is distinct from p_token or p.lease_until is null or p.lease_until<=now() or p.state not in ('working','validating') then return false;end if;
 select * into u from model_uploads where id=p_upload;
 if p_outcome='retry' then
  update model_preparations set state='queued',attempts=greatest(0,attempts-1),lease_token=null,lease_until=null,updated_at=now() where upload_id=p_upload;
  return true;
 elsif p_outcome='failed' then
  update model_preparations set state='failed',error=left(coalesce(p_data->>'error','The workbook could not be validated.'),1000),
   validations=validations||coalesce(p_data->'checks','{}'::jsonb),baseline_result=coalesce(p_data->'result',baseline_result),
   lease_token=null,lease_until=null,updated_at=now() where upload_id=p_upload;
  return true;
 elsif p_outcome in ('analyzed','mapping_required') and p.phase='analyze' then
  if p_data->'manifest'->>'version' is distinct from p.candidate_version or p_data->'manifest'->>'id' is distinct from u.calculator_id then raise exception 'PREPARATION_IDENTITY';end if;
  update model_preparations set state=case when p_outcome='mapping_required' then 'mapping_required' else 'validating' end,
   phase=case when p_outcome='mapping_required' then 'analyze' else 'baseline' end,
   manifest=p_data->'manifest',mapping_report=coalesce(p_data->'mappingReport','{}'::jsonb),
   runtime_path=p_data->>'runtimePath',runtime_sha256=p_data->>'runtimeSha256',
   scenarios=coalesce(p_data->'scenarios','[]'::jsonb),validations=coalesce(p_data->'validations','{}'::jsonb),
   attempts=0,lease_token=null,lease_until=null,updated_at=now() where upload_id=p_upload;
  return true;
 elsif p_outcome='baseline' and p.phase='baseline' then
  if p_data->'check'->>'passed' is distinct from 'true' then raise exception 'BASELINE_REQUIRED';end if;
  update model_preparations set baseline_result=p_data->'result',validations=validations||jsonb_build_object('baseline',p_data->'check'),
   phase=case when jsonb_array_length(scenarios)>0 then 'scenario' else 'export' end,scenario_index=0,attempts=0,
   lease_token=null,lease_until=null,updated_at=now() where upload_id=p_upload;
  return true;
 elsif p_outcome='scenario' and p.phase='scenario' then
  if (p_data->>'index')::integer<>p.scenario_index or p_data->'check'->>'passed' is distinct from 'true' then raise exception 'SCENARIO_REQUIRED';end if;
  v=jsonb_set(p.validations,'{scenarios}',coalesce(p.validations->'scenarios','[]'::jsonb)||jsonb_build_array(p_data->'check'));
  update model_preparations set validations=v,scenario_index=scenario_index+1,
   phase=case when scenario_index+1>=jsonb_array_length(scenarios) then 'export' else 'scenario' end,attempts=0,
   lease_token=null,lease_until=null,updated_at=now() where upload_id=p_upload;
  return true;
 elsif p_outcome='complete' and p.phase='export' then
  if p_data->'reset'->>'passed' is distinct from 'true' or p_data->'export'->>'passed' is distinct from 'true' then raise exception 'EXPORT_REQUIRED';end if;
  v=p.validations||jsonb_build_object('reset',p_data->'reset','export',p_data->'export','limitations',p_data->'limitations');
  update model_preparations set state='ready',phase='complete',validations=v,export_path=p_data->>'exportPath',
   review_hash=md5(jsonb_build_object('revision',p.revision,'manifest',p.manifest,'checks',v,'source',u.sha256,'runtime',p.runtime_sha256)::text),
   attempts=0,lease_token=null,lease_until=null,updated_at=now() where upload_id=p_upload;
  return true;
 end if;
 raise exception 'INVALID_PREPARATION_TRANSITION';
end;$$;

create function public.revise_model_preparation(p_upload uuid,p_actor uuid,p_revision integer,p_mapping jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare p model_preparations;
begin
 if not exists(select 1 from app_administrators where user_id=p_actor) then raise exception 'ADMIN_REQUIRED';end if;
 if jsonb_typeof(p_mapping)<>'object' or octet_length(p_mapping::text)>200000 then raise exception 'INVALID_MAPPING';end if;
 select * into p from model_preparations where upload_id=p_upload for update;
 if not found or p.revision<>p_revision then raise exception 'PREPARATION_CONFLICT';end if;
 if p.state='approved' or p.lease_until>now() then raise exception 'PREPARATION_BUSY';end if;
 update model_preparations set revision=revision+1,candidate_version='release-'||replace(p_upload::text,'-','')||'-r'||(revision+1)::text,
  mapping=p_mapping,state='queued',phase='analyze',mapping_report='{}',manifest=null,runtime_path=null,runtime_sha256=null,
  baseline_result=null,scenarios='[]',scenario_index=0,validations='{}',export_path=null,review_hash=null,error=null,
  attempts=0,lease_token=null,lease_until=null,updated_at=now() where upload_id=p_upload returning * into p;
 return to_jsonb(p);
end;$$;

create function public.approve_model_preparation(p_upload uuid,p_actor uuid,p_revision integer,p_review_hash text,p_expected_base text,p_acknowledged boolean,p_notes text default '')
returns jsonb language plpgsql security definer set search_path=public as $$
declare p model_preparations; u model_uploads; c calculators; m calculator_versions;
begin
 if not exists(select 1 from app_administrators a join auth.users x on x.id=a.user_id where a.user_id=p_actor and x.email_confirmed_at is not null) then raise exception 'ADMIN_REQUIRED';end if;
 select * into u from model_uploads where id=p_upload for update;
 select * into p from model_preparations where upload_id=p_upload for update;
 if p.upload_id is null or p.revision<>p_revision or p_review_hash is null or p.review_hash is null or p.review_hash is distinct from p_review_hash then raise exception 'PREPARATION_CONFLICT';end if;
 select * into c from calculators where id=u.calculator_id for update;
 if p.state='approved' and c.current_version=p.candidate_version then return jsonb_build_object('id',c.id,'currentVersion',c.current_version,'replayed',true);end if;
 if p.state<>'ready' or u.status<>'review_required' or p_acknowledged is distinct from true or length(p_notes)>1000 then raise exception 'REVIEW_REQUIRED';end if;
 if c.current_version is distinct from p_expected_base or u.base_version is distinct from p_expected_base then raise exception 'ACTIVE_MODEL_CHANGED';end if;
 if p.validations->'baseline'->>'passed' is distinct from 'true' or p.validations->'reset'->>'passed' is distinct from 'true'
    or p.validations->'export'->>'passed' is distinct from 'true' or jsonb_array_length(coalesce(p.validations->'scenarios','[]'))<>jsonb_array_length(p.scenarios)
    or exists(select 1 from jsonb_array_elements(coalesce(p.validations->'scenarios','[]')) x where x->>'passed' is distinct from 'true') then raise exception 'VALIDATION_INCOMPLETE';end if;
 select * into m from calculator_versions where calculator_id=u.calculator_id and version=p.candidate_version for update;
 if m.version is null or m.manifest is distinct from p.manifest or m.template_path is distinct from p.runtime_path
    or m.template_sha256 is distinct from p.runtime_sha256 or m.manifest->>'runtimeSha256' is distinct from p.runtime_sha256
    or m.manifest->>'sourceSha256' is distinct from u.sha256 then raise exception 'PREPARATION_IDENTITY';end if;
 update calculator_versions set approved=true,approved_at=now() where calculator_id=u.calculator_id and version=p.candidate_version;
 update calculators set current_version=p.candidate_version,name=m.manifest->>'name',description=m.manifest->>'description' where id=u.calculator_id;
 update model_preparations set state='approved',approved_by=p_actor,approved_at=now(),approval_notes=p_notes,updated_at=now() where upload_id=p_upload;
 update model_uploads set status='approved' where id=p_upload;
 return jsonb_build_object('id',u.calculator_id,'currentVersion',p.candidate_version,'replayed',false);
end;$$;

revoke execute on function public.claim_model_preparation(uuid,uuid,uuid,jsonb),public.finish_model_preparation(uuid,uuid,uuid,text,jsonb),public.revise_model_preparation(uuid,uuid,integer,jsonb),public.approve_model_preparation(uuid,uuid,integer,text,text,boolean,text) from public,anon,authenticated;
grant execute on function public.claim_model_preparation(uuid,uuid,uuid,jsonb),public.finish_model_preparation(uuid,uuid,uuid,text,jsonb),public.revise_model_preparation(uuid,uuid,integer,jsonb),public.approve_model_preparation(uuid,uuid,integer,text,text,boolean,text) to service_role;
comment on table public.model_preparations is 'Private staged model preparation. Completion does not approve or activate a model; an administrator must review the exact report.';
commit;
