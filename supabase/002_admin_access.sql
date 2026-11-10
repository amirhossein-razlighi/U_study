-- Admin panel access. The password is stored only as a bcrypt hash, and the output-to-method
-- map lives only in the database. After applying, set the password from the SQL editor:
--   update public.study_settings
--   set admin_password_hash = extensions.crypt('<password>', extensions.gen_salt('bf', 10));
-- Then load public.study_codebook from .private/codebook.json. Never commit either value.

alter table public.study_settings add column admin_password_hash text;

create table public.study_codebook (
  output_id text primary key,
  scene_id text not null,
  scene_title text not null,
  method_label text not null
);

create table public.study_admin_failures (
  id bigint generated always as identity primary key,
  failed_at timestamptz not null default now()
);

alter table public.study_codebook enable row level security;
alter table public.study_admin_failures enable row level security;
revoke all on public.study_codebook, public.study_admin_failures from anon, authenticated;

-- Returns a status instead of raising, so that failed attempts are recorded.
create function public.study_admin_data(p_password text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ok boolean;
begin
  if (select count(*) from public.study_admin_failures
      where failed_at > now() - interval '15 minutes') >= 10 then
    return jsonb_build_object('status', 'locked');
  end if;

  select admin_password_hash is not null
         and admin_password_hash = extensions.crypt(p_password, admin_password_hash)
    into v_ok
  from public.study_settings;

  if not coalesce(v_ok, false) then
    insert into public.study_admin_failures default values;
    return jsonb_build_object('status', 'denied');
  end if;

  -- The API layer rejects a DELETE that has no WHERE clause.
  delete from public.study_admin_failures where true;

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
    )
  );
end;
$$;

revoke all on function public.study_admin_data(text) from public, anon, authenticated;
grant execute on function public.study_admin_data(text) to service_role;
