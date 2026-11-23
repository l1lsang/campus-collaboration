-- Reports only consume enumerated project evidence. No survey, feedback, or check-in inputs.
create function private.require_report_member(p_project_id uuid) returns void
language plpgsql stable set search_path = '' as $$
begin
  perform private.require_verified_profile();
  if not exists (select 1 from public.project_members m where m.project_id = p_project_id and m.user_id = auth.uid()) then
    raise exception 'PROJECT_MEMBER_REQUIRED';
  end if;
end;
$$;

create function private.require_report_kind(p_kind text) returns void
language plpgsql immutable set search_path = '' as $$
begin
  if p_kind is null or p_kind not in ('activity', 'contribution', 'failure', 'handoff') then
    raise exception 'REPORT_INVALID_KIND';
  end if;
end;
$$;

-- Do not store unknown keys, non-string values, or whitespace-only inputs.
create function private.clean_report_fields(p_input jsonb, p_fields text[], p_limit integer) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare v_result jsonb;
begin
  if p_input is null or jsonb_typeof(p_input) <> 'object' or pg_column_size(p_input) > 65536 then
    raise exception 'REPORT_INVALID_INPUT';
  end if;
  if exists (select 1 from jsonb_each(p_input) f
      where not (f.key = any(p_fields)) or jsonb_typeof(f.value) <> 'string' or char_length(f.value #>> '{}') > p_limit) then
    raise exception 'REPORT_INVALID_INPUT';
  end if;
  select coalesce(jsonb_object_agg(f.key, f.value), '{}'::jsonb) into v_result
  from (select f.key, regexp_replace(f.value, '^[[:space:]]+|[[:space:]]+$', '', 'g') as value
        from jsonb_each_text(p_input) f) f where f.value <> '';
  return v_result;
end;
$$;

create function private.clean_report_inputs(p_inputs jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select private.clean_report_fields(p_inputs, array['goals','roles','results','explanation','failure','nextSteps','handoff'], 2000)
$$;

-- Positive allowlist. Never read team_activity.details (even for an allowed event).
create function private.report_event_label(p_event_type text) returns text
language sql immutable set search_path = '' as $$
  select case p_event_type
    when 'role_assigned' then '업무 역할 변경'
    when 'task_created' then '작업 등록'
    when 'task_updated' then '작업 변경'
    when 'task_moved' then '작업 상태 변경'
    when 'task_completed' then '작업 완료'
  end
$$;

create function private.report_item(p_text text, p_sources text[]) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('text', p_text, 'sourceIds', p_sources)
$$;

-- Build the sections in the database: only the authorized project's data can become a source.
create function private.build_report_draft(p_project_id uuid, p_kind text, p_inputs jsonb) returns jsonb
language sql stable set search_path = '' as $$
  with project as (
    select p.id, p.description, p.status, p.start_date, p.due_date, p.completed_at
    from public.projects p where p.id = p_project_id
  ), evidence as materialized (
    select a.id, a.actor_id, a.event_type, a.created_at, private.report_event_label(a.event_type) as label
    from public.team_activity a
    where a.project_id = p_project_id and private.report_event_label(a.event_type) is not null
    order by a.created_at desc, a.id desc limit 40
  ), timeline as (
    select coalesce(jsonb_agg(private.report_item(
      to_char(e.created_at at time zone 'Asia/Seoul', 'YYYY-MM-DD') || ' · ' || e.label,
      array['activity:' || e.id]) order by e.created_at desc, e.id desc), '[]'::jsonb) as items
    from evidence e
  ), outcomes as (
    select coalesce(jsonb_agg(private.report_item(
      to_char(e.created_at at time zone 'Asia/Seoul', 'YYYY-MM-DD') || ' · ' || e.label,
      array['activity:' || e.id]) order by e.created_at desc, e.id desc), '[]'::jsonb) as items
    from evidence e where e.event_type = 'task_completed'
  ), completed_tasks as (
    select coalesce(jsonb_agg(private.report_item('완료: ' || t.title,
      array['task:' || t.id]) order by t.last_status_at desc, t.id desc), '[]'::jsonb) as items
    from (select t.id, t.title, t.last_status_at from public.team_tasks t
      where t.project_id = p_project_id and t.status = 'done'
      order by t.last_status_at desc, t.id desc limit 20) t
  ), handoff_tasks as (
    select coalesce(jsonb_agg(private.report_item(
      t.title || ' · ' || case t.status when 'blocked' then '진행 차단' when 'review' then '검토 중'
        when 'doing' then '진행 중' else '대기' end
        || ' · 마감: ' || coalesce(to_char(t.due_date, 'YYYY-MM-DD'), '미정')
        || ' · 담당: ' || coalesce(a.names, '미지정'),
      array['task:' || t.id] || a.source_ids) order by t.due_date nulls last, t.id), '[]'::jsonb) as items
    from (select t.id, t.title, t.status, t.due_date from public.team_tasks t
      where t.project_id = p_project_id and t.status <> 'done' and p_kind = 'handoff'
      order by t.due_date nulls last, t.id limit 20) t
    cross join lateral (
      select string_agg(coalesce(p.nickname, '닉네임 없음'), ', ' order by a.membership_id) as names,
        coalesce(array_agg('membership:' || a.membership_id order by a.membership_id), '{}'::text[]) as source_ids
      from public.team_task_assignees a
      join public.project_members m on m.id = a.membership_id and m.project_id = a.project_id
      left join public.profiles p on p.id = m.user_id
      where a.task_id = t.id and a.project_id = p_project_id
    ) a
  ), roster as (
    select coalesce(jsonb_agg(private.report_item(
      coalesce(p.nickname, '닉네임 없음') || ' · ' || case m.membership_role when 'owner' then '팀장' else '팀원' end
        || coalesce(' · ' || r.role_name, '')
        || case when p_kind = 'contribution' then ' · 활동 ' || c.total || '건' else '' end,
      array['membership:' || m.id] || case when r.role_name is not null then array['role:' || m.id] else '{}'::text[] end
        || case when p_kind = 'contribution' then c.source_ids else '{}'::text[] end
      ) order by (m.membership_role = 'owner') desc, m.joined_at, m.id), '[]'::jsonb) as items
    from public.project_members m left join public.profiles p on p.id = m.user_id
    left join public.team_member_roles r on r.project_id = m.project_id and r.membership_id = m.id
    cross join lateral (
      select count(*) as total, coalesce(array_agg('activity:' || e.id order by e.created_at desc, e.id desc), '{}'::text[]) as source_ids
      from evidence e where e.actor_id = m.user_id
    ) c where m.project_id = p_project_id
  ), manual as (
    select f.key, jsonb_build_array(private.report_item(f.value, array['input:' || f.key])) as items
    from jsonb_each_text(p_inputs) f
  ), sections(position, key, items) as (
    select 10, 'context', jsonb_build_array(
      private.report_item(p.description, array['project:' || p.id]),
      private.report_item('상태: ' || case p.status when 'completed' then '완료' when 'paused' then '일시 중단' when 'archived' then '보관' else '진행 중' end
        || ' · 기간: ' || coalesce(to_char(p.start_date, 'YYYY-MM-DD'), '미정') || ' ~ ' || coalesce(to_char(p.due_date, 'YYYY-MM-DD'), '미정')
        || case when p.completed_at is null then '' else ' · 완료일: ' || to_char(p.completed_at at time zone 'Asia/Seoul', 'YYYY-MM-DD') end,
        array['project:' || p.id])) from project p
    union all select 20, 'goals', coalesce((select items from manual where key = 'goals'), '[]'::jsonb)
    union all select 30, 'roles', r.items || coalesce((select items from manual where key = 'roles'), '[]'::jsonb) from roster r
    union all select 40, 'results', t.items || o.items || coalesce((select items from manual where key = 'results'), '[]'::jsonb)
      from completed_tasks t cross join outcomes o
    union all select 50, 'activity', t.items from timeline t where p_kind = 'activity'
    union all select 60, 'explanation', coalesce((select items from manual where key = 'explanation'), '[]'::jsonb)
    union all select 70, 'failure', coalesce((select items from manual where key = 'failure'), '[]'::jsonb)
      where p_kind = 'failure' or p_inputs ? 'failure'
    union all select 80, 'nextSteps', coalesce((select items from manual where key = 'nextSteps'), '[]'::jsonb)
    union all select 90, 'handoff', h.items || coalesce((select items from manual where key = 'handoff'), '[]'::jsonb) from handoff_tasks h
      where p_kind = 'handoff' or p_inputs ? 'handoff'
  )
  select jsonb_build_object(
    'method', 'template',
    'sections', jsonb_agg(jsonb_build_object('key', s.key, 'items', s.items) order by s.position),
    'notes', jsonb_build_array('활동 타임라인과 건수는 이 프로젝트의 최근 허용 활동 최대 40건을 기준으로 합니다.',
      '완료 작업은 상태 변경일이 최근인 순서로, 인수인계 작업은 마감이 먼저인 순서로 각각 최대 20건 표시합니다.',
      '활동 건수는 기여의 크기나 품질을 나타내지 않습니다.',
      '별도 근거가 없으면 실패가 있었다고 추정하지 않습니다. 팀원 입력은 시스템 기록과 구분됩니다.'))
  from sections s
$$;

create function public.preview_project_report(p_project_id uuid, p_kind text, p_inputs jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_report_member(p_project_id);
  perform private.require_report_kind(p_kind);
  return private.build_report_draft(p_project_id, p_kind, private.clean_report_inputs(p_inputs));
end;
$$;

revoke all on function private.require_report_member(uuid), private.require_report_kind(text),
  private.clean_report_fields(jsonb,text[],integer), private.clean_report_inputs(jsonb), private.report_event_label(text),
  private.report_item(text,text[]), private.build_report_draft(uuid,text,jsonb) from public, anon, authenticated;
revoke all on function public.preview_project_report(uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.preview_project_report(uuid,text,jsonb) to authenticated;

-- Revisions preserve the exact draft and inputs from the time of saving, not live evidence.
create table public.project_report_revisions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects on delete cascade,
  kind text not null check (kind in ('activity', 'contribution', 'failure', 'handoff')),
  revision_number integer not null check (revision_number > 0),
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  inputs jsonb not null check (jsonb_typeof(inputs) = 'object'),
  draft jsonb not null check (jsonb_typeof(draft) = 'object'),
  unique (project_id, kind, revision_number),
  unique (project_id, kind, id)
);
create index project_report_creator_idx on public.project_report_revisions (created_by) where created_by is not null;

-- The public document is a manually written, separately stored projection. Do not expose this table directly.
create table public.report_archive_snapshots (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  kind text not null,
  revision_id uuid not null,
  title text not null check (char_length(title) between 2 and 100),
  summary text not null check (char_length(summary) between 1 and 2000),
  results text check (char_length(results) between 1 and 2000),
  lessons text check (char_length(lessons) between 1 and 2000),
  handoff text check (char_length(handoff) between 1 and 2000),
  published_at timestamptz not null default clock_timestamp(),
  unique (project_id, kind),
  foreign key (project_id, kind, revision_id)
    references public.project_report_revisions (project_id, kind, id) on delete cascade
);
create index report_archive_publication_idx on public.report_archive_snapshots (published_at desc, id desc);

alter table public.project_report_revisions enable row level security;
alter table public.report_archive_snapshots enable row level security;
revoke all on public.project_report_revisions, public.report_archive_snapshots from public, anon, authenticated;

create function private.report_revision_json(r public.project_report_revisions) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', r.id, 'number', r.revision_number, 'createdAt', r.created_at,
    'inputs', r.inputs, 'draft', r.draft)
$$;

create function private.report_archive_json(s public.report_archive_snapshots) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_strip_nulls(jsonb_build_object('id', s.id, 'kind', s.kind, 'publishedAt', s.published_at,
    'title', s.title, 'summary', s.summary, 'results', s.results, 'lessons', s.lessons, 'handoff', s.handoff))
$$;

create function private.lock_report_owner(p_project_id uuid) returns void
language plpgsql set search_path = '' as $$
begin
  perform private.require_verified_profile();
  perform 1 from public.projects p where p.id = p_project_id and p.owner_id = auth.uid() for update;
  if not found then raise exception 'PROJECT_OWNER_REQUIRED'; end if;
  if not exists (select 1 from public.project_members m
      where m.project_id = p_project_id and m.user_id = auth.uid() and m.membership_role = 'owner') then
    raise exception 'PROJECT_OWNER_REQUIRED';
  end if;
end;
$$;

create function public.get_project_report_workspace(p_project_id uuid, p_kind text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_is_owner boolean; v_title text; v_revision jsonb; v_publication jsonb;
begin
  perform private.require_report_member(p_project_id);
  perform private.require_report_kind(p_kind);
  select p.title, p.owner_id = auth.uid() and m.membership_role = 'owner' into v_title, v_is_owner
  from public.projects p join public.project_members m on m.project_id = p.id and m.user_id = auth.uid()
  where p.id = p_project_id;
  select private.report_revision_json(r) into v_revision from public.project_report_revisions r
    where r.project_id = p_project_id and r.kind = p_kind order by r.revision_number desc limit 1;
  if v_is_owner then
    select private.report_archive_json(s) || jsonb_build_object('revisionNumber', r.revision_number) into v_publication
    from public.report_archive_snapshots s join public.project_report_revisions r on r.id = s.revision_id
    where s.project_id = p_project_id and s.kind = p_kind;
  end if;
  return jsonb_build_object('title', v_title, 'isOwner', v_is_owner, 'latestRevision', v_revision, 'publication', v_publication);
end;
$$;

create function public.list_project_report_revisions(p_project_id uuid, p_kind text, p_before integer default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_report_member(p_project_id);
  perform private.require_report_kind(p_kind);
  return (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'number', r.revision_number, 'createdAt', r.created_at)
    order by r.revision_number desc), '[]'::jsonb)
    from (select r.id, r.revision_number, r.created_at from public.project_report_revisions r
      where r.project_id = p_project_id and r.kind = p_kind and (p_before is null or r.revision_number < p_before)
      order by r.revision_number desc limit 30) r);
end;
$$;

create function public.get_project_report_revision(p_project_id uuid, p_kind text, p_revision_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_revision jsonb;
begin
  perform private.require_report_member(p_project_id);
  perform private.require_report_kind(p_kind);
  select private.report_revision_json(r) into v_revision from public.project_report_revisions r
    where r.project_id = p_project_id and r.kind = p_kind and r.id = p_revision_id;
  if not found then raise exception 'REPORT_REVISION_NOT_FOUND'; end if;
  return v_revision;
end;
$$;

create function public.save_project_report(p_project_id uuid, p_kind text, p_expected_number integer, p_inputs jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_current integer; v_inputs jsonb; v_revision public.project_report_revisions;
begin
  perform private.require_report_member(p_project_id);
  perform private.require_report_kind(p_kind);
  v_inputs := private.clean_report_inputs(p_inputs);
  -- Serialize adjacent revision numbers and recheck authorization after waiting for the lock.
  perform 1 from public.projects p where p.id = p_project_id for update;
  perform private.require_report_member(p_project_id);
  select coalesce(max(r.revision_number), 0) into v_current from public.project_report_revisions r
    where r.project_id = p_project_id and r.kind = p_kind;
  if p_expected_number is distinct from v_current then raise exception 'REPORT_REVISION_CONFLICT'; end if;
  insert into public.project_report_revisions (project_id, kind, revision_number, created_by, inputs, draft)
    values (p_project_id, p_kind, v_current + 1, auth.uid(), v_inputs, private.build_report_draft(p_project_id, p_kind, v_inputs))
    returning * into v_revision;
  return private.report_revision_json(v_revision);
end;
$$;

create function public.publish_project_report(p_project_id uuid, p_kind text, p_revision_id uuid, p_opt_in boolean, p_content jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_content jsonb; v_revision_number integer; v_snapshot public.report_archive_snapshots;
begin
  perform private.lock_report_owner(p_project_id);
  perform private.require_report_kind(p_kind);
  if p_opt_in is distinct from true then raise exception 'REPORT_PUBLIC_OPT_IN_REQUIRED'; end if;
  select r.revision_number into v_revision_number from public.project_report_revisions r
    where r.project_id = p_project_id and r.kind = p_kind and r.id = p_revision_id;
  if not found then raise exception 'REPORT_REVISION_NOT_FOUND'; end if;
  v_content := private.clean_report_fields(p_content, array['title','summary','results','lessons','handoff'], 2000);
  if not (v_content ? 'title' and v_content ? 'summary') or char_length(v_content->>'title') not between 2 and 100 then
    raise exception 'REPORT_INVALID_INPUT';
  end if;
  insert into public.report_archive_snapshots (project_id, kind, revision_id, title, summary, results, lessons, handoff)
    values (p_project_id, p_kind, p_revision_id, v_content->>'title', v_content->>'summary',
      v_content->>'results', v_content->>'lessons', v_content->>'handoff')
    on conflict (project_id, kind) do update set revision_id = excluded.revision_id,
      title = excluded.title, summary = excluded.summary, results = excluded.results, lessons = excluded.lessons,
      handoff = excluded.handoff, published_at = excluded.published_at
    returning * into v_snapshot;
  return private.report_archive_json(v_snapshot) || jsonb_build_object('revisionNumber', v_revision_number);
end;
$$;

create function public.unpublish_project_report(p_project_id uuid, p_kind text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.lock_report_owner(p_project_id);
  perform private.require_report_kind(p_kind);
  delete from public.report_archive_snapshots s where s.project_id = p_project_id and s.kind = p_kind;
end;
$$;

create function public.list_report_archive(p_before timestamptz default null, p_before_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if (p_before is null) <> (p_before_id is null) then raise exception 'REPORT_INVALID_CURSOR'; end if;
  return (select coalesce(jsonb_agg(private.report_archive_json(s) order by s.published_at desc, s.id desc), '[]'::jsonb)
    from (select a.* from public.report_archive_snapshots a
      where p_before is null or (a.published_at, a.id) < (p_before, p_before_id)
      order by a.published_at desc, a.id desc limit 24) s);
end;
$$;

revoke all on function private.report_revision_json(public.project_report_revisions),
  private.report_archive_json(public.report_archive_snapshots), private.lock_report_owner(uuid) from public, anon, authenticated;
revoke all on function public.get_project_report_workspace(uuid,text), public.list_project_report_revisions(uuid,text,integer),
  public.get_project_report_revision(uuid,text,uuid), public.save_project_report(uuid,text,integer,jsonb),
  public.publish_project_report(uuid,text,uuid,boolean,jsonb), public.unpublish_project_report(uuid,text),
  public.list_report_archive(timestamptz,uuid) from public, anon, authenticated;
grant execute on function public.get_project_report_workspace(uuid,text), public.list_project_report_revisions(uuid,text,integer),
  public.get_project_report_revision(uuid,text,uuid), public.save_project_report(uuid,text,integer,jsonb),
  public.publish_project_report(uuid,text,uuid,boolean,jsonb), public.unpublish_project_report(uuid,text) to authenticated;
grant execute on function public.list_report_archive(timestamptz,uuid) to anon, authenticated;
