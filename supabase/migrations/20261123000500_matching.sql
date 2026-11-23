create table public.matching_opportunities (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references auth.users on delete cascade,
  type text not null check (type in ('idea', 'reboot', 'contest')),
  title text not null check (char_length(title) between 2 and 100),
  description text not null check (char_length(description) between 10 and 4000),
  roles text[] not null check (private.valid_tags(roles)),
  skills text[] not null default '{}' check (cardinality(skills) = 0 or private.valid_tags(skills)),
  university_id uuid references public.universities on delete set null,
  major text check (char_length(major) between 1 and 80),
  gap text check (char_length(gap) between 2 and 1000),
  source_project_id uuid references public.projects on delete set null,
  competition text check (char_length(competition) between 2 and 100),
  format text check (format in ('online', 'offline', 'hybrid')),
  deadline timestamptz check (isfinite(deadline)),
  project_id uuid unique references public.projects on delete set null,
  project_created_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  check (project_id is null or project_created_at is not null),
  check (
    (type = 'idea' and gap is not null and source_project_id is null and competition is null and format is null and deadline is null)
    -- A previously public source may be deleted. The creation RPC always requires it.
    or (type = 'reboot' and gap is null and competition is null and format is null and deadline is null)
    or (type = 'contest' and gap is null and source_project_id is null and competition is not null and format is not null and deadline is not null)
  )
);

create table public.matching_requests (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.matching_opportunities on delete cascade,
  applicant_id uuid not null references auth.users on delete cascade,
  message text not null check (char_length(message) between 2 and 2000),
  selected_role text check (char_length(selected_role) between 1 and 40),
  timezone text check (char_length(timezone) between 1 and 64),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  unique (opportunity_id, applicant_id),
  check ((status = 'pending') = (decided_at is null))
);

create index matching_open_latest_idx on public.matching_opportunities(created_at desc, id desc) where closed_at is null;
create index matching_author_latest_idx on public.matching_opportunities(author_id, created_at desc, id desc);
create index matching_university_idx on public.matching_opportunities(university_id) where university_id is not null;
create index matching_source_idx on public.matching_opportunities(source_project_id) where source_project_id is not null;
create index matching_request_applicant_idx on public.matching_requests(applicant_id, created_at desc, id desc);

-- Default-deny RLS: even SELECT goes through purpose-built RPCs, never through raw rows.
-- The board must not expose account IDs or the ID of a private linked project.
alter table public.matching_opportunities enable row level security;
alter table public.matching_requests enable row level security;
revoke all on public.matching_opportunities, public.matching_requests from public, anon, authenticated;

create function private.matching_trim(p_value text) returns text
language sql immutable strict set search_path = '' as $$
  select regexp_replace(p_value, '^[[:space:]]+|[[:space:]]+$', '', 'g');
$$;
revoke all on function private.matching_trim(text) from public, anon, authenticated;

create function public.create_matching_opportunity(
  p_type text, p_title text, p_description text, p_roles text[], p_skills text[] default '{}',
  p_university_id uuid default null, p_major text default null, p_gap text default null,
  p_source_project_id uuid default null, p_competition text default null, p_format text default null,
  p_deadline timestamptz default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_author uuid := auth.uid();
  v_roles text[] := array(select private.matching_trim(value) from unnest(p_roles) with ordinality t(value, ord) order by ord);
  v_skills text[] := array(select private.matching_trim(value) from unnest(p_skills) with ordinality t(value, ord) order by ord);
  v_major text := nullif(private.matching_trim(p_major), '');
  v_gap text := nullif(private.matching_trim(p_gap), '');
  v_competition text := nullif(private.matching_trim(p_competition), '');
  v_title text := private.matching_trim(p_title);
  v_description text := private.matching_trim(p_description);
begin
  perform private.require_verified_profile();
  if v_title is null or char_length(v_title) not between 2 and 100
      or v_description is null or char_length(v_description) not between 10 and 4000
      or char_length(v_major) > 80 or not private.valid_tags(v_roles)
      or (cardinality(v_skills) > 0 and not private.valid_tags(v_skills)) then
    raise exception 'MATCHING_INVALID_DETAILS';
  end if;
  if p_type is null or p_type not in ('idea', 'reboot', 'contest')
    or (p_type = 'idea' and (v_gap is null or char_length(v_gap) not between 2 and 1000 or p_source_project_id is not null or v_competition is not null or p_format is not null or p_deadline is not null))
    or (p_type = 'reboot' and (p_source_project_id is null or v_gap is not null or v_competition is not null or p_format is not null or p_deadline is not null))
    or (p_type = 'contest' and (v_gap is not null or p_source_project_id is not null or v_competition is null or char_length(v_competition) not between 2 and 100 or p_format is null or p_format not in ('online','offline','hybrid') or p_deadline is null or not isfinite(p_deadline) or p_deadline <= clock_timestamp())) then
    raise exception 'MATCHING_INVALID_TYPE_FIELDS';
  end if;
  if p_university_id is not null and not exists (select 1 from public.universities u where u.id = p_university_id and u.is_active) then
    raise exception 'MATCHING_INVALID_UNIVERSITY';
  end if;
  -- Serialize creation per author, then check the source without reading any of its content.
  perform 1 from auth.users where id = v_author for no key update;
  if (select count(*) from public.matching_opportunities o where o.author_id = v_author and o.created_at > now() - interval '1 day') >= 20 then
    raise exception 'MATCHING_RATE_LIMIT';
  end if;
  if p_type = 'reboot' then
    perform 1 from public.projects p where p.id = p_source_project_id and p.visibility = 'public'
      and p.status in ('paused', 'completed', 'archived') for share;
    if not found then raise exception 'MATCHING_REBOOT_SOURCE_UNAVAILABLE'; end if;
  end if;
  insert into public.matching_opportunities(type, author_id, title, description, roles, skills, university_id, major, gap, source_project_id, competition, format, deadline)
  values(p_type, v_author, v_title, v_description, v_roles, v_skills, p_university_id, v_major, v_gap, p_source_project_id, v_competition, p_format, p_deadline)
  returning id into v_id;
  return v_id;
end;
$$;

create function public.list_matching_opportunities(
  p_type text default null, p_mine boolean default false, p_university_id uuid default null,
  p_major text default null, p_skill text default null, p_role text default null,
  p_competition text default null, p_format text default null, p_offset integer default 0
) returns table (
  id uuid, type text, title text, description text, roles text[], skills text[], university_name text, major text,
  gap text, source_project_id uuid, competition text, format text, deadline timestamptz,
  is_mine boolean, is_open boolean, request_status text, project_id uuid
) language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid := auth.uid();
begin
  perform private.require_verified_profile();
  return query
    select o.id, o.type, o.title, o.description, o.roles, o.skills, u.name, o.major,
      o.gap, source.id, o.competition, o.format, o.deadline, o.author_id = v_user,
      o.closed_at is null and (o.deadline is null or o.deadline > now()), r.status,
      case when m.user_id is not null then o.project_id end
    from public.matching_opportunities o
    left join public.universities u on u.id = o.university_id
    left join public.projects source on source.id = o.source_project_id and source.visibility = 'public'
    left join public.matching_requests r on r.opportunity_id = o.id and r.applicant_id = v_user
    left join public.project_members m on m.project_id = o.project_id and m.user_id = v_user
    where (case when p_mine then o.author_id = v_user else o.closed_at is null and (o.deadline is null or o.deadline > now()) end)
      and (p_type is null or o.type = p_type)
      and (p_university_id is null or o.university_id = p_university_id)
      and (nullif(btrim(p_major), '') is null or strpos(lower(o.major), lower(btrim(p_major))) > 0)
      and (nullif(btrim(p_skill), '') is null or exists (select 1 from unnest(o.skills) value where strpos(lower(value), lower(btrim(p_skill))) > 0))
      and (nullif(btrim(p_role), '') is null or exists (select 1 from unnest(o.roles) value where strpos(lower(value), lower(btrim(p_role))) > 0))
      and (nullif(btrim(p_competition), '') is null or strpos(lower(o.competition), lower(btrim(p_competition))) > 0)
      and (p_format is null or o.format = p_format)
    order by o.created_at desc, o.id desc limit 21 offset greatest(p_offset, 0);
end;
$$;

create function public.list_matching_reboot_sources(p_search text default null, p_offset integer default 0)
returns table (id uuid, title text) language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_verified_profile();
  return query select p.id, p.title from public.projects p
    where p.visibility = 'public' and p.status in ('paused', 'completed', 'archived')
      and (nullif(btrim(p_search), '') is null or strpos(lower(p.title), lower(btrim(p_search))) > 0)
    order by p.created_at desc, p.id desc limit 21 offset greatest(p_offset, 0);
end;
$$;

create function public.close_matching_opportunity(p_opportunity_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_verified_profile();
  update public.matching_opportunities o set closed_at = coalesce(o.closed_at, clock_timestamp())
    where o.id = p_opportunity_id and o.author_id = auth.uid();
  if not found then raise exception 'MATCHING_OPPORTUNITY_UNAVAILABLE'; end if;
end;
$$;

create function public.submit_matching_request(
  p_opportunity_id uuid, p_message text, p_role text default null, p_timezone text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_op public.matching_opportunities%rowtype;
  v_id uuid;
  v_applicant uuid := auth.uid();
  v_message text := private.matching_trim(p_message);
  v_role text := nullif(private.matching_trim(p_role), '');
  v_timezone text := nullif(private.matching_trim(p_timezone), '');
begin
  perform private.require_verified_profile();
  select o.* into v_op from public.matching_opportunities o where o.id = p_opportunity_id for update;
  if not found then raise exception 'MATCHING_OPPORTUNITY_UNAVAILABLE'; end if;
  if v_op.author_id = v_applicant then raise exception 'MATCHING_OWN_OPPORTUNITY'; end if;
  if v_op.closed_at is not null or v_op.deadline <= clock_timestamp() then raise exception 'MATCHING_OPPORTUNITY_CLOSED'; end if;
  if v_message is null or char_length(v_message) not between 2 and 2000 then raise exception 'MATCHING_INVALID_MESSAGE'; end if;
  if v_role is not null and not (v_role = any(v_op.roles)) then raise exception 'MATCHING_INVALID_ROLE'; end if;
  if v_timezone is not null and (char_length(v_timezone) > 64 or not exists (select 1 from pg_catalog.pg_timezone_names t where t.name = v_timezone)) then
    raise exception 'MATCHING_INVALID_TIMEZONE';
  end if;
  insert into public.matching_requests(opportunity_id, applicant_id, message, selected_role, timezone)
    values(p_opportunity_id, v_applicant, v_message, v_role, v_timezone)
    on conflict (opportunity_id, applicant_id) do nothing returning id into v_id;
  if not found then raise exception 'MATCHING_DUPLICATE_REQUEST'; end if;
  return v_id;
end;
$$;

create function public.list_matching_requests(p_received boolean default false, p_offset integer default 0)
returns table (
  id uuid, opportunity_title text, type text, message text, applicant_nickname text,
  selected_role text, timezone text, status text, created_at timestamptz, project_id uuid
) language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid := auth.uid();
begin
  perform private.require_verified_profile();
  return query select r.id, o.title, o.type, r.message, case when p_received then p.nickname end,
    r.selected_role, r.timezone, r.status, r.created_at, case when r.status = 'accepted' and m.user_id is not null then o.project_id end
    from public.matching_requests r join public.matching_opportunities o on o.id = r.opportunity_id
    left join public.profiles p on p.id = r.applicant_id
    left join public.project_members m on m.project_id = o.project_id and m.user_id = v_user
    where (case when p_received then o.author_id = v_user else r.applicant_id = v_user end)
    order by r.created_at desc, r.id desc limit 21 offset greatest(p_offset, 0);
end;
$$;

create function public.decide_matching_request(p_request_id uuid, p_accept boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_author uuid := auth.uid();
  v_op public.matching_opportunities%rowtype;
  v_req public.matching_requests%rowtype;
  v_project uuid;
begin
  perform private.require_verified_profile();
  if p_accept is null then raise exception 'MATCHING_INVALID_DECISION'; end if;
  -- Lock the opportunity before the request so approvals, closure and submissions serialize.
  select o.* into v_op from public.matching_opportunities o join public.matching_requests r on r.opportunity_id = o.id
    where r.id = p_request_id and o.author_id = v_author for update of o;
  if not found then raise exception 'MATCHING_REQUEST_UNAVAILABLE'; end if;
  select r.* into v_req from public.matching_requests r where r.id = p_request_id for update;
  if not found then raise exception 'MATCHING_REQUEST_UNAVAILABLE'; end if;
  if v_req.status <> 'pending' then raise exception 'MATCHING_REQUEST_DECIDED'; end if;
  if p_accept then
    v_project := v_op.project_id;
    if v_project is null then
      if v_op.project_created_at is not null then raise exception 'MATCHING_PROJECT_UNAVAILABLE'; end if;
      -- For reboots, only the author's new pitch is used. Never copy source files, metadata, or members.
      v_project := public.create_project(v_op.title, v_op.description,
        (case when v_op.type = 'contest' then 'competition' else 'side_project' end)::public.project_category, 'private');
      update public.matching_opportunities set project_id = v_project, project_created_at = clock_timestamp() where id = v_op.id;
    else
      perform 1 from public.projects p where p.id = v_project and p.owner_id = v_author and p.status = 'active' for share;
      if not found then raise exception 'MATCHING_PROJECT_UNAVAILABLE'; end if;
    end if;
    insert into public.project_members(project_id, user_id, membership_role)
      values(v_project, v_req.applicant_id, 'member') on conflict (project_id, user_id) do nothing;
  end if;
  update public.matching_requests set status = case when p_accept then 'accepted' else 'rejected' end,
    decided_at = clock_timestamp() where id = p_request_id;
  return v_project;
end;
$$;

revoke all on function public.create_matching_opportunity(text,text,text,text[],text[],uuid,text,text,uuid,text,text,timestamptz),
  public.list_matching_opportunities(text,boolean,uuid,text,text,text,text,text,integer), public.list_matching_reboot_sources(text,integer),
  public.close_matching_opportunity(uuid), public.submit_matching_request(uuid,text,text,text),
  public.list_matching_requests(boolean,integer), public.decide_matching_request(uuid,boolean) from public, anon, authenticated;
grant execute on function public.create_matching_opportunity(text,text,text,text[],text[],uuid,text,text,uuid,text,text,timestamptz),
  public.list_matching_opportunities(text,boolean,uuid,text,text,text,text,text,integer), public.list_matching_reboot_sources(text,integer),
  public.close_matching_opportunity(uuid), public.submit_matching_request(uuid,text,text,text),
  public.list_matching_requests(boolean,integer), public.decide_matching_request(uuid,boolean) to authenticated;
