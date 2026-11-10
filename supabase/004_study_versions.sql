-- Rankings from studies with different videos are not comparable, so the admin panel only
-- reads the version named in study_settings. Older responses stay in the database.

alter table public.study_settings add column current_version text not null default 'v1';
alter table public.study_codebook add column study_version text not null default 'v1';
alter table public.study_codebook alter column study_version drop default;

create or replace function public.submit_study_response(p_access text, p_payload jsonb)
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
  v_count integer;
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
    if jsonb_typeof(v_answer->'ranking') is distinct from 'array' then
      raise exception 'ranking must be an array';
    end if;
    v_count := jsonb_array_length(v_answer->'ranking');
    if v_count < 2
       or (select count(distinct r->>'output_id') from jsonb_array_elements(v_answer->'ranking') r) <> v_count
       or (select array_agg((r->>'rank')::int order by (r->>'rank')::int)
           from jsonb_array_elements(v_answer->'ranking') r)
          <> (select array_agg(g order by g) from generate_series(1, v_count) g) then
      raise exception 'each ranking must place every output at a distinct rank';
    end if;
    if not v_debug and v_count is distinct from
       (select count(*) from public.study_codebook c where c.scene_id = v_answer->>'scene_id') then
      raise exception 'ranking does not match the videos in this scene';
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

create or replace function public.study_admin_data(p_password text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text := public.study_admin_check(p_password);
  v_version text;
begin
  if v_status <> 'ok' then
    return jsonb_build_object('status', v_status);
  end if;

  select current_version into v_version from public.study_settings;

  return jsonb_build_object(
    'status', 'ok',
    'generated_at', now(),
    'codebook', (select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) from public.study_codebook c where c.study_version = v_version),
    'responses', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'submission_id', r.submission_id,
        'study_version', r.study_version,
        'is_debug', r.is_debug,
        'started_at', r.started_at,
        'submitted_at', r.submitted_at,
        'received_at', r.received_at,
        'answers', r.answers
      ) order by r.received_at), '[]'::jsonb)
      from public.study_responses r
      where r.deleted_at is null and r.study_version = v_version
    )
  );
end;
$$;

revoke all on function public.submit_study_response(text, jsonb) from public, anon, authenticated;
revoke all on function public.study_admin_data(text) from public, anon, authenticated;
grant execute on function public.submit_study_response(text, jsonb) to service_role;
grant execute on function public.study_admin_data(text) to service_role;
