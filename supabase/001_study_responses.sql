-- Only the study-api Edge Function can call the two functions below, so publishable
-- keys have no access to this data. After applying, set the access value used in study links:
--   insert into public.study_settings (access_value) values ('<long random string>');

create table public.study_settings (
  id boolean primary key default true check (id),
  access_value text not null check (length(access_value) >= 16)
);

create table public.study_responses (
  submission_id uuid primary key,
  study_version text not null,
  is_debug boolean not null default false,
  started_at timestamptz,
  submitted_at timestamptz,
  received_at timestamptz not null default now(),
  scene_order text[] not null,
  answers jsonb not null,
  feedback text check (length(feedback) <= 2000)
);

alter table public.study_settings enable row level security;
alter table public.study_responses enable row level security;
revoke all on public.study_settings, public.study_responses from anon, authenticated;

create function public.study_check_access(p_access text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.study_settings where access_value = p_access);
$$;

create function public.submit_study_response(p_access text, p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := (p_payload->>'submission_id')::uuid;
  v_debug boolean := coalesce((p_payload->>'is_debug')::boolean, false);
  v_answers jsonb := p_payload->'answers';
  v_scene_order text[];
  v_answer jsonb;
begin
  if not public.study_check_access(p_access) then
    raise exception 'invalid access value';
  end if;
  if pg_column_size(p_payload) > 200000 then
    raise exception 'payload too large';
  end if;
  if jsonb_typeof(v_answers) is distinct from 'array' then
    raise exception 'answers must be an array';
  end if;

  select array_agg(value) into v_scene_order
  from jsonb_array_elements_text(p_payload->'scene_order');

  if not v_debug and jsonb_array_length(v_answers) is distinct from cardinality(v_scene_order) then
    raise exception 'every scene must be ranked';
  end if;

  for v_answer in select value from jsonb_array_elements(v_answers) loop
    if not (v_answer->>'scene_id' = any (v_scene_order)) then
      raise exception 'unknown scene in answers';
    end if;
    if jsonb_typeof(v_answer->'ranking') is distinct from 'array'
       or jsonb_array_length(v_answer->'ranking') <> 3
       or (select count(distinct r->>'output_id') from jsonb_array_elements(v_answer->'ranking') r) <> 3
       or (select array_agg((r->>'rank')::int order by (r->>'rank')::int)
           from jsonb_array_elements(v_answer->'ranking') r) <> array[1, 2, 3] then
      raise exception 'each ranking must place three outputs at ranks 1, 2, 3';
    end if;
  end loop;

  insert into public.study_responses
    (submission_id, study_version, is_debug, started_at, submitted_at, scene_order, answers, feedback)
  values
    (v_id, p_payload->>'study_version', v_debug, (p_payload->>'started_at')::timestamptz,
     (p_payload->>'submitted_at')::timestamptz, v_scene_order, v_answers, p_payload->>'feedback')
  on conflict (submission_id) do nothing;

  return v_id;
end;
$$;

revoke all on function public.study_check_access(text) from public;
revoke all on function public.submit_study_response(text, jsonb) from public;
revoke execute on function public.study_check_access(text) from anon, authenticated;
revoke execute on function public.submit_study_response(text, jsonb) from anon, authenticated;
grant execute on function public.study_check_access(text) to service_role;
grant execute on function public.submit_study_response(text, jsonb) to service_role;

-- One row per output per scene, production responses only. For analysis in the SQL editor.
create view public.study_rankings with (security_invoker = true) as
select
  r.submission_id,
  r.study_version,
  r.received_at,
  a->>'scene_id' as scene_id,
  (a->>'active_ms')::bigint as active_ms,
  e->>'output_id' as output_id,
  (e->>'position')::int as position,
  (e->>'rank')::int as rank,
  (e->>'auto')::boolean as auto_filled,
  (e->>'plays')::int as plays,
  (e->>'listened_seconds')::numeric as listened_seconds
from public.study_responses r
cross join lateral jsonb_array_elements(r.answers) a
cross join lateral jsonb_array_elements(a->'ranking') e
where not r.is_debug;

revoke all on public.study_rankings from anon, authenticated;
