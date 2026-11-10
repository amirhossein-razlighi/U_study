-- Admin "delete" only sets deleted_at. The row stays in the database and leaves every result.
-- To restore a response in the SQL editor:
--   update public.study_responses set deleted_at = null where submission_id = '<id>';

alter table public.study_responses add column deleted_at timestamptz;

create function public.study_admin_check(p_password text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ok boolean;
begin
  if (select count(*) from public.study_admin_failures
      where failed_at > now() - interval '15 minutes') >= 10 then
    return 'locked';
  end if;

  select admin_password_hash is not null
         and admin_password_hash = extensions.crypt(p_password, admin_password_hash)
    into v_ok
  from public.study_settings;

  if not coalesce(v_ok, false) then
    insert into public.study_admin_failures default values;
    return 'denied';
  end if;

  -- The API layer rejects a DELETE that has no WHERE clause.
  delete from public.study_admin_failures where true;
  return 'ok';
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
begin
  if v_status <> 'ok' then
    return jsonb_build_object('status', v_status);
  end if;

  return jsonb_build_object(
    'status', 'ok',
    'generated_at', now(),
    'codebook', (select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) from public.study_codebook c),
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
      where r.deleted_at is null
    )
  );
end;
$$;

create function public.study_admin_delete_response(p_password text, p_submission_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text := public.study_admin_check(p_password);
  v_count integer;
begin
  if v_status <> 'ok' then
    return jsonb_build_object('status', v_status);
  end if;

  update public.study_responses
  set deleted_at = now()
  where submission_id = p_submission_id and deleted_at is null;
  get diagnostics v_count = row_count;

  return jsonb_build_object('status', 'ok', 'deleted', v_count > 0);
end;
$$;

create or replace view public.study_rankings with (security_invoker = true) as
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
where not r.is_debug and r.deleted_at is null;

revoke all on public.study_rankings from anon, authenticated;
revoke all on function public.study_admin_check(text) from public, anon, authenticated, service_role;
revoke all on function public.study_admin_data(text) from public, anon, authenticated;
revoke all on function public.study_admin_delete_response(text, uuid) from public, anon, authenticated;
grant execute on function public.study_admin_data(text) to service_role;
grant execute on function public.study_admin_delete_response(text, uuid) to service_role;
