-- Phase 1: keep identity verification, project membership and invitations server-controlled.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;
create extension if not exists pgcrypto with schema extensions;

create table public.universities (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(btrim(name)) between 2 and 100),
  short_name text not null check (char_length(btrim(short_name)) between 2 and 40),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.university_email_domains (
  id uuid primary key default gen_random_uuid(),
  university_id uuid not null references public.universities on delete cascade,
  email_domain text not null unique check (email_domain ~ '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$' and char_length(email_domain) <= 253),
  is_active boolean not null default true
);
create index university_domains_university_idx on public.university_email_domains(university_id);

create table public.university_verifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users on delete cascade,
  university_id uuid not null references public.universities on delete cascade,
  verification_method text not null default 'confirmed_account_email' check (verification_method = 'confirmed_account_email'),
  verified_email text not null check (verified_email = lower(verified_email) and char_length(verified_email) <= 254),
  status text not null default 'verified' check (status in ('verified', 'revoked')),
  verified_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index university_verifications_school_idx on public.university_verifications(university_id);

create type public.project_category as enum ('course', 'competition', 'hackathon', 'startup', 'side_project', 'research', 'creative', 'other');
create type public.content_visibility as enum ('private', 'public');

create function private.valid_tags(tags text[]) returns boolean
language sql immutable set search_path = '' as $$
  select cardinality(tags) between 1 and 10
    and coalesce(array_ndims(tags) = 1, false)
    and not exists (select 1 from unnest(tags) tag where tag is null or char_length(btrim(tag)) not between 1 and 40)
    and cardinality(tags) = (select count(distinct tag) from unnest(tags) tag)
$$;
revoke all on function private.valid_tags(text[]) from public, anon, authenticated;
grant execute on function private.valid_tags(text[]) to authenticated, service_role;

create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  nickname text not null check (char_length(btrim(nickname)) between 2 and 30),
  university_id uuid references public.universities on delete set null,
  major text not null check (char_length(btrim(major)) between 1 and 80),
  bio text not null check (char_length(btrim(bio)) between 1 and 1000),
  skills text[] not null check (private.valid_tags(skills)),
  interests text[] not null check (private.valid_tags(interests)),
  preferred_category public.project_category not null,
  visibility public.content_visibility not null default 'private',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index profiles_university_idx on public.profiles(university_id);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users on delete cascade,
  title text not null check (char_length(btrim(title)) between 2 and 100),
  description text not null check (char_length(btrim(description)) between 10 and 4000),
  category public.project_category not null,
  status text not null default 'active' check (status in ('active', 'completed', 'paused', 'archived')),
  visibility public.content_visibility not null default 'private',
  start_date date,
  due_date date,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (start_date is null or due_date is null or start_date <= due_date)
);
create index projects_owner_idx on public.projects(owner_id);
create index public_projects_latest_idx on public.projects(created_at desc) where visibility = 'public';

create table public.project_members (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  membership_role text not null check (membership_role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  unique (project_id, user_id)
);
create unique index project_single_owner_idx on public.project_members(project_id) where membership_role = 'owner';
create index project_members_user_idx on public.project_members(user_id, joined_at desc);

create table public.project_invitations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects on delete cascade,
  inviter_id uuid not null references auth.users on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  status text not null default 'active' check (status in ('active', 'accepted', 'revoked')),
  accepted_by uuid references auth.users on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at),
  check ((status = 'accepted') = (accepted_at is not null))
);
create index project_invitations_project_idx on public.project_invitations(project_id, created_at desc);
create index project_invitations_inviter_idx on public.project_invitations(inviter_id);
create index project_invitations_accepted_by_idx on public.project_invitations(accepted_by) where accepted_by is not null;

create function private.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end;
$$;
revoke all on function private.touch_updated_at() from public, anon, authenticated;
create trigger profiles_touch before update on public.profiles for each row execute function private.touch_updated_at();
create trigger projects_touch before update on public.projects for each row execute function private.touch_updated_at();

alter table public.universities enable row level security;
alter table public.university_email_domains enable row level security;
alter table public.university_verifications enable row level security;
alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.project_invitations enable row level security;

-- Explicit grants also work on projects with Supabase's automatic table grants disabled.
revoke all on public.universities, public.university_email_domains, public.university_verifications,
  public.profiles, public.projects, public.project_members, public.project_invitations from public, anon, authenticated;
grant select on public.universities, public.profiles to anon, authenticated;
grant select (id,title,description,category,status,visibility,start_date,due_date,created_at) on public.projects to anon, authenticated;
grant insert (id,nickname,university_id,major,bio,skills,interests,preferred_category,visibility),
  update (nickname,university_id,major,bio,skills,interests,preferred_category,visibility) on public.profiles to authenticated;
grant select on public.project_members to authenticated;
grant all on public.universities, public.university_email_domains, public.university_verifications,
  public.profiles, public.projects, public.project_members, public.project_invitations to service_role;

-- A self-declared school is a profile field, not proof of student status.
create policy active_university_read on public.universities for select to anon, authenticated using (is_active);
-- Profiles default to private; a member shares their nickname within the team through a dedicated RPC only.
create policy public_profile_read on public.profiles for select to anon, authenticated using (visibility = 'public');
create policy self_profile_read on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy self_profile_insert on public.profiles for insert to authenticated with check (
  id = (select auth.uid()) and exists (select 1 from public.universities u where u.id = university_id and u.is_active)
);
create policy self_profile_update on public.profiles for update to authenticated using (id = (select auth.uid())) with check (
  id = (select auth.uid()) and exists (select 1 from public.universities u where u.id = university_id and u.is_active)
);
-- The public may read deliberately published summaries, not membership or invite rows.
create policy public_project_read on public.projects for select to anon, authenticated using (visibility = 'public');
-- Direct membership reads expose only the requester's own rows. Full roster uses explicit RPC access checks.
create policy self_membership_read on public.project_members for select to authenticated using (user_id = (select auth.uid()));
create policy member_project_read on public.projects for select to authenticated using (
  exists (select 1 from public.project_members m where m.project_id = projects.id and m.user_id = (select auth.uid()))
);
-- Domain settings, verification rows and token hashes have no API table grants and no client policies.

create function private.current_verified_university() returns uuid
language sql stable security definer set search_path = '' as $$
  select v.university_id
  from public.university_verifications v
  join auth.users a on a.id = v.user_id and lower(a.email) = v.verified_email
  join public.universities u on u.id = v.university_id and u.is_active
  join public.university_email_domains d on d.university_id = v.university_id and d.is_active
    and split_part(v.verified_email, '@', 2) = d.email_domain
  where v.user_id = (select auth.uid()) and v.status = 'verified' and a.email_confirmed_at is not null
    and not coalesce(a.is_anonymous, false)
$$;
revoke all on function private.current_verified_university() from public, anon, authenticated;

create function public.my_university_verification() returns uuid
language sql stable security definer set search_path = '' as $$
  select private.current_verified_university()
$$;

create function public.verify_university_email() returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_email text;
  v_school uuid;
begin
  select lower(a.email) into v_email from auth.users a
  where a.id = v_user and a.email_confirmed_at is not null and not coalesce(a.is_anonymous, false);
  if v_email is null then raise exception 'CONFIRMED_EMAIL_REQUIRED'; end if;
  select d.university_id into v_school from public.university_email_domains d
  join public.universities u on u.id = d.university_id and u.is_active
  where d.email_domain = split_part(v_email, '@', 2) and d.is_active;
  if v_school is null then raise exception 'SCHOOL_DOMAIN_NOT_REGISTERED'; end if;
  -- A service/operator revocation is not bypassable by pressing verify again.
  insert into public.university_verifications (user_id, university_id, verified_email)
  values (v_user, v_school, v_email)
  on conflict (user_id) do update set university_id = excluded.university_id,
    verified_email = excluded.verified_email, verified_at = now()
  where university_verifications.status = 'verified'
  returning university_id into v_school;
  if v_school is null then raise exception 'SCHOOL_VERIFICATION_REVOKED'; end if;
  return v_school;
end;
$$;

create function private.require_verified_profile() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if private.current_verified_university() is null then raise exception 'VERIFIED_UNIVERSITY_REQUIRED'; end if;
  if not exists (select 1 from public.profiles where id = auth.uid()) then raise exception 'PROFILE_REQUIRED'; end if;
end;
$$;
revoke all on function private.require_verified_profile() from public, anon, authenticated;

create function public.create_project(
  p_title text, p_description text, p_category public.project_category, p_visibility public.content_visibility,
  p_start_date date default null, p_due_date date default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform private.require_verified_profile();
  -- Serialize the owner's daily cap across concurrent requests.
  perform 1 from auth.users where id = auth.uid() for update;
  if (select count(*) from public.projects where owner_id = auth.uid() and created_at > now() - interval '1 day') >= 20 then
    raise exception 'PROJECT_RATE_LIMIT';
  end if;
  insert into public.projects(owner_id,title,description,category,visibility,start_date,due_date)
  values(auth.uid(),btrim(p_title),btrim(p_description),p_category,p_visibility,p_start_date,p_due_date) returning id into v_id;
  insert into public.project_members(project_id,user_id,membership_role) values(v_id,auth.uid(),'owner');
  return v_id;
end;
$$;

create function public.list_project_members(p_project_id uuid)
returns table (membership_id uuid, nickname text, membership_role text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.project_members m where m.project_id = p_project_id and m.user_id = auth.uid()) then
    raise exception 'PROJECT_MEMBER_REQUIRED';
  end if;
  return query select m.id, p.nickname, m.membership_role from public.project_members m
    left join public.profiles p on p.id = m.user_id where m.project_id = p_project_id
    order by (m.membership_role = 'owner') desc, m.joined_at, m.user_id;
end;
$$;

create function public.create_project_invite(p_project_id uuid)
returns table (invite_id uuid, token text, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare v_token text;
begin
  perform 1 from public.projects p where p.id = p_project_id and p.owner_id = auth.uid() for update;
  if not found then raise exception 'PROJECT_OWNER_REQUIRED'; end if;
  perform private.require_verified_profile();
  if (select count(*) from public.project_invitations i where i.project_id = p_project_id and i.created_at > now() - interval '1 day') >= 30 then
    raise exception 'INVITE_RATE_LIMIT';
  end if;
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  return query insert into public.project_invitations as i (project_id,inviter_id,token_hash,expires_at)
    values(p_project_id,auth.uid(),encode(extensions.digest(v_token,'sha256'),'hex'),now()+interval '7 days')
    returning i.id, v_token, i.expires_at;
end;
$$;

create function public.list_project_invites(p_project_id uuid)
returns table (id uuid, status text, created_at timestamptz, expires_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.projects p where p.id = p_project_id and p.owner_id = auth.uid()) then
    raise exception 'PROJECT_OWNER_REQUIRED';
  end if;
  -- Return no token, hash, or recipient email, even to the project owner.
  return query select i.id, case when i.status = 'active' and i.expires_at <= now() then 'expired' else i.status end,
      i.created_at, i.expires_at from public.project_invitations i where i.project_id = p_project_id
      order by i.created_at desc, i.id desc limit 30;
end;
$$;

create function public.revoke_project_invite(p_invite_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.project_invitations i set status = 'revoked' from public.projects p
  where i.id = p_invite_id and p.id = i.project_id and p.owner_id = auth.uid()
    and i.status = 'active' and i.expires_at > now();
  if not found then raise exception 'INVITE_UNAVAILABLE'; end if;
end;
$$;

create function public.accept_project_invite(p_token text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_invite public.project_invitations%rowtype;
begin
  perform private.require_verified_profile();
  if p_token is null or char_length(p_token) <> 64 or p_token !~ '^[0-9a-f]{64}$' then
    raise exception 'INVITE_UNAVAILABLE';
  end if;
  select * into v_invite from public.project_invitations i
    where i.token_hash = encode(extensions.digest(p_token,'sha256'),'hex')
    and i.status = 'active' and i.expires_at > clock_timestamp() for update;
  if not found or v_invite.expires_at <= clock_timestamp() then raise exception 'INVITE_UNAVAILABLE'; end if;
  insert into public.project_members(project_id,user_id,membership_role)
    values(v_invite.project_id,auth.uid(),'member') on conflict (project_id,user_id) do nothing;
  if not found then raise exception 'ALREADY_PROJECT_MEMBER'; end if;
  update public.project_invitations set status = 'accepted', accepted_by = auth.uid(), accepted_at = now()
    where id = v_invite.id;
  return v_invite.project_id;
end;
$$;

-- Only signed-in sessions can invoke these RPCs; every privileged entry checks the user's scope.
revoke all on function public.my_university_verification(), public.verify_university_email(),
  public.create_project(text,text,public.project_category,public.content_visibility,date,date),
  public.list_project_members(uuid), public.create_project_invite(uuid), public.list_project_invites(uuid),
  public.revoke_project_invite(uuid), public.accept_project_invite(text) from public, anon, authenticated;
grant execute on function public.my_university_verification(), public.verify_university_email(),
  public.create_project(text,text,public.project_category,public.content_visibility,date,date),
  public.list_project_members(uuid), public.create_project_invite(uuid), public.list_project_invites(uuid),
  public.revoke_project_invite(uuid), public.accept_project_invite(text) to authenticated;

-- Production also needs the initial school catalog; no student domains are guessed.
insert into public.universities (name,short_name) values
 ('성신여자대학교','성신여대'), ('덕성여자대학교','덕성여대'), ('한성대학교','한성대') on conflict(name) do nothing;
