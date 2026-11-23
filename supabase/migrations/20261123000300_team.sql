-- Teamplog data is exposed only by explicitly authorized, field-allowlisted RPCs.
alter table public.project_members add constraint project_members_project_id_id_key unique (project_id, id);

create table public.team_member_roles (
  project_id uuid not null,
  membership_id uuid primary key,
  role_name text not null check (char_length(role_name) between 1 and 60),
  foreign key (project_id, membership_id) references public.project_members (project_id, id) on delete cascade
);

create table public.team_tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  description text not null check (char_length(description) <= 2000),
  weight integer not null check (weight between 1 and 10),
  due_date date check (isfinite(due_date)),
  status text not null default 'todo' check (status in ('todo', 'doing', 'review', 'done', 'blocked')),
  created_at timestamptz not null default now(),
  last_status_at timestamptz not null default now(),
  unique (project_id, id)
);

create table public.team_task_assignees (
  project_id uuid not null,
  task_id uuid not null,
  membership_id uuid not null,
  primary key (task_id, membership_id),
  foreign key (project_id, task_id) references public.team_tasks (project_id, id) on delete cascade,
  foreign key (project_id, membership_id) references public.project_members (project_id, id) on delete cascade
);
create index team_task_assignees_membership_idx on public.team_task_assignees (project_id, membership_id);

-- Reports consume only allowlisted event types. Never log private survey activity here.
create table public.team_activity (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects on delete cascade,
  actor_id uuid references auth.users on delete set null,
  event_type text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index team_activity_project_date_idx on public.team_activity (project_id, created_at desc, id desc);
create index team_activity_actor_idx on public.team_activity (actor_id);

create table public.team_feedback_rounds (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects on delete cascade,
  title text not null check (char_length(title) between 1 and 100),
  closes_at timestamptz not null,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  check (closes_at > created_at and isfinite(closes_at))
);
create index team_feedback_rounds_project_idx on public.team_feedback_rounds (project_id, created_at desc, id desc);

-- Scoped keys give one vote per account even after leaving/rejoining. No identity
-- or membership lookup ever reads these tables, and deleting an account cannot
-- change a published aggregate by subtracting that account's contribution.
create table public.team_feedback_answers (
  round_id uuid not null references public.team_feedback_rounds on delete cascade,
  respondent_key uuid not null,
  coordination integer not null check (coordination between 1 and 5),
  communication integer not null check (communication between 1 and 5),
  comment text check (char_length(comment) <= 1000),
  primary key (round_id, respondent_key)
);

create table public.team_checkins (
  project_id uuid not null references public.projects on delete cascade,
  week_start date not null,
  respondent_key uuid not null,
  workload integer not null check (workload between 1 and 5),
  capacity integer not null check (capacity between 1 and 5),
  needs_help boolean not null,
  primary key (project_id, week_start, respondent_key)
);

alter table public.team_member_roles enable row level security;
alter table public.team_tasks enable row level security;
alter table public.team_task_assignees enable row level security;
alter table public.team_activity enable row level security;
alter table public.team_feedback_rounds enable row level security;
alter table public.team_feedback_answers enable row level security;
alter table public.team_checkins enable row level security;
revoke all on public.team_member_roles, public.team_tasks, public.team_task_assignees, public.team_activity,
  public.team_feedback_rounds, public.team_feedback_answers, public.team_checkins from public, anon, authenticated;
revoke all on public.team_feedback_answers, public.team_checkins from service_role;

create function private.team_access(p_project_id uuid, p_owner_only boolean default false) returns uuid
language plpgsql stable set search_path = '' as $$
declare
  v_membership_id uuid;
  v_is_owner boolean;
begin
  perform private.require_verified_profile();
  select m.id, m.membership_role = 'owner' and p.owner_id = m.user_id into v_membership_id, v_is_owner
  from public.project_members m join public.projects p on p.id = m.project_id
  where m.project_id = p_project_id and m.user_id = auth.uid();
  if not found then raise exception 'PROJECT_MEMBER_REQUIRED'; end if;
  if p_owner_only and not v_is_owner then raise exception 'PROJECT_OWNER_REQUIRED'; end if;
  return v_membership_id;
end;
$$;

create function private.team_trim(p_value text) returns text
language sql immutable set search_path = '' as $$
  select regexp_replace(p_value, '^[[:space:]]+|[[:space:]]+$', '', 'g')
$$;

-- Use different opaque account keys per survey/period; there is no joinable
-- account identifier in the response tables. These keys are only used for submission uniqueness.
create function private.team_respondent_key(p_scope text) returns uuid
language sql stable set search_path = '' as $$
  select md5(p_scope || ':' || auth.uid()::text)::uuid
$$;

create function private.team_week_start(p_at timestamptz) returns date
language sql immutable set search_path = '' as $$
  select date_trunc('week', p_at at time zone 'Asia/Seoul')::date
$$;

create function private.team_normalize_assignees(p_project_id uuid, p_assignees uuid[]) returns uuid[]
language plpgsql stable set search_path = '' as $$
declare v_ids uuid[];
begin
  if p_assignees is null or cardinality(p_assignees) > 100 or exists (
    select 1 from unnest(p_assignees) a(id) where not exists (
      select 1 from public.project_members m where m.project_id = p_project_id and m.id = a.id
    )
  ) then raise exception 'TEAM_INVALID_ASSIGNEES'; end if;
  select coalesce(array_agg(distinct a.id order by a.id), '{}'::uuid[]) into v_ids from unnest(p_assignees) a(id);
  return v_ids;
end;
$$;

create function public.team_assign_role(p_project_id uuid, p_membership_id uuid, p_role_name text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_role text := nullif(private.team_trim(p_role_name), '');
begin
  perform private.team_access(p_project_id, true);
  if not exists (select 1 from public.project_members m where m.project_id = p_project_id and m.id = p_membership_id) then
    raise exception 'TEAM_INVALID_MEMBER';
  end if;
  if char_length(v_role) > 60 then raise exception 'TEAM_INVALID_ROLE'; end if;
  if v_role is null then
    delete from public.team_member_roles r where r.project_id = p_project_id and r.membership_id = p_membership_id;
  else
    insert into public.team_member_roles(project_id, membership_id, role_name) values (p_project_id, p_membership_id, v_role)
    on conflict (membership_id) do update set role_name = excluded.role_name;
  end if;
  if found then
    insert into public.team_activity(project_id, actor_id, event_type) values (p_project_id, auth.uid(), 'role_assigned');
  end if;
end;
$$;

create function public.team_create_task(p_project_id uuid, p_title text, p_description text, p_weight integer,
  p_due_date date, p_assignees uuid[]) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_task uuid;
  v_assignees uuid[];
  v_title text := private.team_trim(p_title);
  v_description text := coalesce(private.team_trim(p_description), '');
begin
  perform private.team_access(p_project_id, true);
  if v_title is null or char_length(v_title) not between 1 and 120 or char_length(v_description) > 2000
    or p_weight is null or p_weight not between 1 and 10 or not isfinite(p_due_date) then
    raise exception 'TEAM_INVALID_TASK';
  end if;
  v_assignees := private.team_normalize_assignees(p_project_id, p_assignees);
  insert into public.team_tasks(project_id, title, description, weight, due_date)
  values (p_project_id, v_title, v_description, p_weight, p_due_date) returning id into v_task;
  insert into public.team_task_assignees(project_id, task_id, membership_id)
  select p_project_id, v_task, a.id from unnest(v_assignees) a(id);
  insert into public.team_activity(project_id, actor_id, event_type) values (p_project_id, auth.uid(), 'task_created');
  return v_task;
end;
$$;

create function public.team_set_task_assignees(p_task_id uuid, p_assignees uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_project uuid;
  v_assignees uuid[];
begin
  select t.project_id into v_project from public.team_tasks t where t.id = p_task_id;
  perform private.team_access(v_project, true);
  perform 1 from public.team_tasks t where t.id = p_task_id for update;
  v_assignees := private.team_normalize_assignees(v_project, p_assignees);
  if v_assignees = array(select a.membership_id from public.team_task_assignees a where a.task_id = p_task_id order by a.membership_id) then return; end if;
  delete from public.team_task_assignees a where a.task_id = p_task_id;
  insert into public.team_task_assignees(project_id, task_id, membership_id)
  select v_project, p_task_id, a.id from unnest(v_assignees) a(id);
  insert into public.team_activity(project_id, actor_id, event_type) values (v_project, auth.uid(), 'task_updated');
end;
$$;

create function public.team_set_task_status(p_task_id uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_project uuid;
  v_membership uuid;
  v_previous text;
begin
  select t.project_id into v_project from public.team_tasks t where t.id = p_task_id;
  v_membership := private.team_access(v_project);
  select t.status into v_previous from public.team_tasks t where t.id = p_task_id for update;
  if not exists (select 1 from public.projects p join public.project_members m on m.id = v_membership
    where p.id = v_project and p.owner_id = auth.uid() and m.membership_role = 'owner')
    and not exists (select 1 from public.team_task_assignees a where a.task_id = p_task_id and a.membership_id = v_membership) then
    raise exception 'TEAM_TASK_ASSIGNEE_REQUIRED';
  end if;
  if p_status is null or p_status not in ('todo', 'doing', 'review', 'done', 'blocked') then
    raise exception 'TEAM_INVALID_STATUS';
  end if;
  if v_previous = p_status then return; end if;
  update public.team_tasks t set status = p_status, last_status_at = clock_timestamp() where t.id = p_task_id;
  insert into public.team_activity(project_id, actor_id, event_type)
  values (v_project, auth.uid(), case when p_status = 'done' then 'task_completed' else 'task_moved' end);
end;
$$;

-- Survey writes serialize with the workbench read on the project row. This
-- keeps a pre-deadline submission from changing an aggregate already shown.
create function public.team_open_feedback(p_project_id uuid, p_title text, p_closes_at timestamptz) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_title text := private.team_trim(p_title);
begin
  perform private.team_access(p_project_id, true);
  perform 1 from public.projects p where p.id = p_project_id for no key update;
  if v_title is null or char_length(v_title) not between 1 and 100 or p_closes_at is null
    or not isfinite(p_closes_at) or p_closes_at <= clock_timestamp() then
    raise exception 'TEAM_INVALID_FEEDBACK_ROUND';
  end if;
  insert into public.team_feedback_rounds(project_id, title, closes_at)
  values (p_project_id, v_title, p_closes_at) returning id into v_id;
  return v_id;
end;
$$;

create function public.team_close_feedback(p_round_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_project uuid;
begin
  select r.project_id into v_project from public.team_feedback_rounds r where r.id = p_round_id;
  perform private.team_access(v_project, true);
  perform 1 from public.projects p where p.id = v_project for no key update;
  update public.team_feedback_rounds r set closed_at = clock_timestamp()
  where r.id = p_round_id and r.closed_at is null and r.closes_at > clock_timestamp();
end;
$$;

create function public.team_submit_feedback(p_round_id uuid, p_coordination integer, p_communication integer, p_comment text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_project uuid;
  v_comment text := nullif(private.team_trim(p_comment), '');
begin
  select r.project_id into v_project from public.team_feedback_rounds r where r.id = p_round_id;
  perform private.team_access(v_project);
  perform 1 from public.projects p where p.id = v_project for no key update;
  if not exists (select 1 from public.team_feedback_rounds r
    where r.id = p_round_id and r.closed_at is null and r.closes_at > clock_timestamp()) then
    raise exception 'TEAM_FEEDBACK_CLOSED';
  end if;
  if p_coordination is null or p_coordination not between 1 and 5 or p_communication is null or p_communication not between 1 and 5 then
    raise exception 'TEAM_INVALID_SCORE';
  end if;
  if char_length(v_comment) > 1000 then raise exception 'TEAM_INVALID_COMMENT'; end if;
  insert into public.team_feedback_answers(round_id, respondent_key, coordination, communication, comment)
  values (p_round_id, private.team_respondent_key('feedback:' || p_round_id), p_coordination, p_communication, v_comment)
  on conflict do nothing;
  if not found then raise exception 'TEAM_FEEDBACK_ALREADY_SUBMITTED'; end if;
end;
$$;

create function public.team_submit_checkin(p_project_id uuid, p_workload integer, p_capacity integer, p_needs_help boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v_week date;
begin
  perform private.team_access(p_project_id);
  perform 1 from public.projects p where p.id = p_project_id for no key update;
  if p_workload is null or p_workload not between 1 and 5 or p_capacity is null or p_capacity not between 1 and 5 or p_needs_help is null then
    raise exception 'TEAM_INVALID_SCORE';
  end if;
  v_week := private.team_week_start(clock_timestamp());
  insert into public.team_checkins(project_id, week_start, respondent_key, workload, capacity, needs_help)
  values (p_project_id, v_week, private.team_respondent_key('checkin:' || p_project_id || ':' || to_char(v_week, 'YYYY-MM-DD')), p_workload, p_capacity, p_needs_help)
  on conflict do nothing;
  if not found then raise exception 'TEAM_CHECKIN_ALREADY_SUBMITTED'; end if;
end;
$$;

create function public.team_workbench(p_project_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_membership uuid;
  v_title text;
  v_owner uuid;
  v_now timestamptz;
  v_week date;
begin
  v_membership := private.team_access(p_project_id);
  select p.title, p.owner_id into v_title, v_owner from public.projects p where p.id = p_project_id for share;
  v_now := clock_timestamp();
  v_week := private.team_week_start(v_now);
  return jsonb_build_object(
    'project_title', v_title,
    'my_membership_id', v_membership,
    'is_owner', v_owner = auth.uid() and exists (select 1 from public.project_members m where m.id = v_membership and m.membership_role = 'owner'),
    'members', coalesce((select jsonb_agg(jsonb_build_object(
      'membership_id', m.id, 'nickname', p.nickname, 'membership_role', m.membership_role, 'role_name', r.role_name
    ) order by (m.membership_role = 'owner') desc, m.joined_at, m.id)
      from public.project_members m left join public.profiles p on p.id = m.user_id
      left join public.team_member_roles r on r.membership_id = m.id where m.project_id = p_project_id), '[]'::jsonb),
    'tasks', coalesce((select jsonb_agg(jsonb_build_object(
      'id', t.id, 'title', t.title, 'description', t.description, 'status', t.status, 'weight', t.weight,
      'due_date', t.due_date, 'last_status_at', t.last_status_at,
      'assignees', array(select a.membership_id from public.team_task_assignees a where a.task_id = t.id order by a.membership_id)
    ) order by t.created_at desc, t.id desc) from public.team_tasks t where t.project_id = p_project_id), '[]'::jsonb),
    'feedback', coalesce((select jsonb_agg(jsonb_build_object(
      'id', r.id, 'title', r.title, 'closes_at', least(r.closes_at, r.closed_at), 'closed', r.closed,
      'submitted', exists (select 1 from public.team_feedback_answers a where a.round_id = r.id
        and a.respondent_key = private.team_respondent_key('feedback:' || r.id)),
      'summary', case when r.closed then (select jsonb_build_object(
        'coordination_average', round(avg(a.coordination), 1), 'communication_average', round(avg(a.communication), 1)
      ) from public.team_feedback_answers a where a.round_id = r.id having count(*) >= 3) else null end
    ) order by r.created_at desc, r.id desc) from (
      select f.*, f.closed_at is not null or f.closes_at <= v_now as closed
      from public.team_feedback_rounds f where f.project_id = p_project_id
    ) r), '[]'::jsonb),
    'checkin', jsonb_build_object('week_start', v_week,
      'submitted', exists (select 1 from public.team_checkins c where c.project_id = p_project_id and c.week_start = v_week
        and c.respondent_key = private.team_respondent_key('checkin:' || p_project_id || ':' || to_char(v_week, 'YYYY-MM-DD'))),
      'summary', (select jsonb_build_object('workload_average', round(avg(c.workload), 1),
        'capacity_average', round(avg(c.capacity), 1), 'needs_help', count(*) filter (where c.needs_help) >= 3)
        from public.team_checkins c where c.project_id = p_project_id and c.week_start = v_week - 7 having count(*) >= 3)
    )
  );
end;
$$;

revoke all on function private.team_access(uuid, boolean), private.team_trim(text), private.team_respondent_key(text),
  private.team_week_start(timestamptz), private.team_normalize_assignees(uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.team_assign_role(uuid, uuid, text), public.team_create_task(uuid, text, text, integer, date, uuid[]),
  public.team_set_task_assignees(uuid, uuid[]), public.team_set_task_status(uuid, text), public.team_open_feedback(uuid, text, timestamptz),
  public.team_close_feedback(uuid), public.team_submit_feedback(uuid, integer, integer, text), public.team_submit_checkin(uuid, integer, integer, boolean),
  public.team_workbench(uuid) from public, anon, authenticated;
grant execute on function public.team_assign_role(uuid, uuid, text), public.team_create_task(uuid, text, text, integer, date, uuid[]),
  public.team_set_task_assignees(uuid, uuid[]), public.team_set_task_status(uuid, text), public.team_open_feedback(uuid, text, timestamptz),
  public.team_close_feedback(uuid), public.team_submit_feedback(uuid, integer, integer, text), public.team_submit_checkin(uuid, integer, integer, boolean),
  public.team_workbench(uuid) to authenticated;
