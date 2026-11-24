-- A creation consumes quota even if its content is later removed. Store only
-- the account and creation time, with no FK locks on users or deleted projects.
create table private.project_creation_history (
  account_id uuid not null,
  created_at timestamptz not null
);
create index project_creation_history_account_idx on private.project_creation_history(account_id, created_at);
create index project_creation_history_expiry_idx on private.project_creation_history(created_at);
alter table private.project_creation_history enable row level security;
revoke all on private.project_creation_history from public, anon, authenticated, service_role;

create function private.record_project_creation() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into private.project_creation_history(account_id, created_at) values (new.owner_id, new.created_at);
  return new;
end;
$$;
revoke all on function private.record_project_creation() from public, anon, authenticated, service_role;
-- The trigger's table lock blocks concurrent inserts through the backfill so
-- each creation is either recorded by the trigger or included here, not both.
create trigger project_record_creation after insert on public.projects
  for each row execute function private.record_project_creation();
insert into private.project_creation_history(account_id, created_at)
select owner_id, created_at from public.projects where created_at > now() - interval '1 day';

create or replace function public.create_project(
  p_title text, p_description text, p_category public.project_category, p_visibility public.content_visibility,
  p_start_date date default null, p_due_date date default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_account uuid := auth.uid();
  v_cutoff timestamptz := now() - interval '1 day';
begin
  perform private.require_verified_profile();
  -- Keep the existing per-account serialization for both manual and matching creation.
  perform 1 from auth.users where id = v_account for update;
  if (select count(*) from private.project_creation_history h
      where h.account_id = v_account and h.created_at > v_cutoff) >= 20 then
    raise exception 'PROJECT_RATE_LIMIT';
  end if;
  -- Age out even inactive accounts in bounded batches without waiting on other creators.
  delete from private.project_creation_history h where h.ctid in (
    select expired.ctid from private.project_creation_history expired
    where expired.created_at <= v_cutoff order by expired.created_at limit 64 for update skip locked
  );
  insert into public.projects(owner_id,title,description,category,visibility,start_date,due_date)
  values(v_account,btrim(p_title),btrim(p_description),p_category,p_visibility,p_start_date,p_due_date) returning id into v_id;
  insert into public.project_members(project_id,user_id,membership_role) values(v_id,v_account,'owner');
  return v_id;
end;
$$;

-- Lifecycle management requires both the recorded owner and the owner membership.
create function private.can_manage_project(p_project_id uuid) returns boolean
language sql stable set search_path = '' as $$
  select private.current_verified_university() is not null
    and exists (select 1 from public.profiles f where f.id = auth.uid())
    and exists (
      select 1 from public.projects p join public.project_members m
        on m.project_id = p.id and m.user_id = p.owner_id and m.membership_role = 'owner'
      where p.id = p_project_id and p.owner_id = auth.uid()
    )
$$;
revoke all on function private.can_manage_project(uuid) from public, anon, authenticated, service_role;

-- Match approvals take opportunity -> request -> project locks. Both lifecycle
-- actions follow that order. Deletion also locks source-only FK references in
-- ID order, but neither action closes a recruitment just because of its source.
create function private.lock_project_recruitment(p_project_id uuid, p_lock_sources boolean) returns uuid
language plpgsql set search_path = '' as $$
declare
  v_op record;
  v_attached uuid;
begin
  for v_op in
    select o.id, o.project_id from public.matching_opportunities o
    where o.project_id = p_project_id or (p_lock_sources and o.source_project_id = p_project_id)
    order by o.id for update
  loop
    if v_op.project_id = p_project_id then v_attached := v_op.id; end if;
  end loop;
  if v_attached is not null then
    perform 1 from public.matching_requests r
    where r.opportunity_id = v_attached and r.status = 'pending' order by r.id for update;
  end if;
  return v_attached;
end;
$$;

-- Finish and delete both close directly attached recruitment and settle only
-- pending applications. Preserve accepted decisions and prior closure times.
-- Finish keeps the project link; delete lets the FK detach it while keeping
-- the project_created_at guard against replacement.
create function private.close_project_recruitment(p_opportunity_id uuid, p_at timestamptz) returns void
language plpgsql set search_path = '' as $$
begin
  if p_opportunity_id is null then return; end if;
  update public.matching_opportunities o set closed_at = p_at
    where o.id = p_opportunity_id and o.closed_at is null;
  update public.matching_requests r set status = 'rejected', decided_at = p_at
    where r.opportunity_id = p_opportunity_id and r.status = 'pending';
end;
$$;
revoke all on function private.lock_project_recruitment(uuid, boolean), private.close_project_recruitment(uuid, timestamptz)
  from public, anon, authenticated, service_role;

create function public.complete_project(p_project_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_status text;
  v_attached_opportunity uuid;
  v_completed_at timestamptz;
begin
  if not private.can_manage_project(p_project_id) then
    raise exception 'PROJECT_MANAGEMENT_NOT_ALLOWED';
  end if;

  v_attached_opportunity := private.lock_project_recruitment(p_project_id, false);
  select p.status into v_status from public.projects p
  where p.id = p_project_id and p.owner_id = auth.uid() for no key update;
  if not found then raise exception 'PROJECT_MANAGEMENT_NOT_ALLOWED'; end if;

  perform 1 from public.project_members m
  where m.project_id = p_project_id and m.user_id = auth.uid() and m.membership_role = 'owner' for share;
  if not found or not private.can_manage_project(p_project_id) then
    raise exception 'PROJECT_MANAGEMENT_NOT_ALLOWED';
  end if;

  if v_status = 'completed' then return p_project_id; end if;
  if v_status not in ('active', 'paused') then raise exception 'PROJECT_CANNOT_COMPLETE'; end if;

  v_completed_at := clock_timestamp();
  perform private.close_project_recruitment(v_attached_opportunity, v_completed_at);
  update public.projects p set status = 'completed', completed_at = v_completed_at
  where p.id = p_project_id;
  return p_project_id;
end;
$$;

create function public.delete_project(p_project_id uuid, p_confirm boolean) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_attached_opportunity uuid;
begin
  if not private.can_manage_project(p_project_id) then
    raise exception 'PROJECT_MANAGEMENT_NOT_ALLOWED';
  end if;
  if p_confirm is distinct from true then raise exception 'PROJECT_DELETE_CONFIRMATION_REQUIRED'; end if;

  v_attached_opportunity := private.lock_project_recruitment(p_project_id, true);

  perform 1 from public.projects p
  where p.id = p_project_id and p.owner_id = auth.uid() for update;
  if not found or not private.can_manage_project(p_project_id) then
    raise exception 'PROJECT_MANAGEMENT_NOT_ALLOWED';
  end if;

  -- The full project lock conflicts with the FK's KEY SHARE. No research test
  -- (open or closed) can link between this check and deletion.
  if exists (select 1 from public.research_tests t where t.project_id = p_project_id) then
    raise exception 'PROJECT_HAS_RESEARCH';
  end if;

  -- A reboot source may have been linked before the project lock was acquired.
  -- Recheck without waiting, as with invite/task/role writers that may hold a
  -- child lock before taking a project FK lock. Contention fails atomically.
  perform 1 from public.matching_opportunities o
    where o.project_id = p_project_id or o.source_project_id = p_project_id
    order by o.id for update nowait;
  -- A late direct attachment (not created by the matching RPC) needs a retry
  -- rather than taking its request locks after the project lock.
  if exists (select 1 from public.matching_opportunities o
    where o.project_id = p_project_id and o.id is distinct from v_attached_opportunity) then
    raise exception 'Concurrent project recruitment attachment' using errcode = '55P03';
  end if;
  perform 1 from public.project_invitations i where i.project_id = p_project_id for update nowait;
  perform 1 from public.team_tasks t where t.project_id = p_project_id for update nowait;
  perform 1 from public.project_members m where m.project_id = p_project_id for update nowait;
  perform 1 from public.team_member_roles r join public.project_members m on m.id = r.membership_id
    where m.project_id = p_project_id for update of r nowait;
  if not private.can_manage_project(p_project_id) then
    raise exception 'PROJECT_MANAGEMENT_NOT_ALLOWED';
  end if;

  perform private.close_project_recruitment(v_attached_opportunity, clock_timestamp());
  delete from public.projects p where p.id = p_project_id;
  return p_project_id;
end;
$$;

revoke all on function public.complete_project(uuid), public.delete_project(uuid, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.complete_project(uuid), public.delete_project(uuid, boolean) to authenticated;
