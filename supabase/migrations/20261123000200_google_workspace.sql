-- Supabase Auth validates the provider's Google ID token. Use its identity data, never editable user metadata.
create function private.workspace_school(p_provider text,p_claims jsonb) returns uuid
language sql stable security definer set search_path='' as $$
 select u.id from public.university_email_domains d join public.universities u on u.id=d.university_id
 where p_provider='google' and p_claims->>'email_verified'='true'
 and lower(coalesce(p_claims#>>'{custom_claims,hd}',p_claims->>'hd'))=d.email_domain
 and nullif(btrim(p_claims->>'email'),'') is not null and d.is_active and u.is_active
$$;
revoke all on function private.workspace_school(text,jsonb) from public,anon,authenticated;

-- This guard runs on create, link and refresh of provider identity data, not just initial account creation.
create function private.guard_google_workspace_identity() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.provider='google' and private.workspace_school(new.provider,new.identity_data) is null then
   raise exception 'SCHOOL_GOOGLE_ACCOUNT_REQUIRED' using errcode='23514';
 end if;
 return new;
end;
$$;
revoke all on function private.guard_google_workspace_identity() from public,anon,authenticated;
create trigger campus_school_google_identity before insert or update of identity_data, provider on auth.identities
for each row execute function private.guard_google_workspace_identity();

create or replace function private.current_verified_university() returns uuid
language sql stable security definer set search_path='' as $$
 select private.workspace_school(i.provider,i.identity_data)
 from auth.users a join auth.identities i on i.user_id=a.id and i.provider='google'
 where a.id=(select auth.uid()) and a.email_confirmed_at is not null and not coalesce(a.is_anonymous,false)
 and lower(a.email)=lower(i.identity_data->>'email')
 and coalesce(auth.jwt()->'amr' @> '[{"method":"oauth"}]'::jsonb,false)
 and not exists(select 1 from public.university_verifications v where v.user_id=a.id and v.status='revoked')
 and private.workspace_school(i.provider,i.identity_data) is not null
 limit 1
$$;
grant execute on function private.current_verified_university() to authenticated;

create or replace function public.verify_university_email() returns uuid
language plpgsql stable security definer set search_path='' as $$
declare v_id uuid;
begin
 if not exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null) then
   raise exception 'CONFIRMED_EMAIL_REQUIRED';
 end if;
 v_id:=private.current_verified_university();
 if v_id is null then raise exception 'SCHOOL_DOMAIN_NOT_REGISTERED'; end if;
 return v_id;
end;
$$;

-- Strict cuts for previous OTP sessions and school affiliation spoofing, also when called directly against the REST API.
alter policy self_profile_read on public.profiles using (id=(select auth.uid()) and (select private.current_verified_university()) is not null);
alter policy self_profile_insert on public.profiles with check (id=(select auth.uid()) and university_id=(select private.current_verified_university()));
alter policy self_profile_update on public.profiles using (id=(select auth.uid()) and (select private.current_verified_university()) is not null)
  with check (id=(select auth.uid()) and university_id=(select private.current_verified_university()));
alter policy self_membership_read on public.project_members using (user_id=(select auth.uid()) and (select private.current_verified_university()) is not null);

create or replace function public.list_project_members(p_project_id uuid)
returns table (membership_id uuid, nickname text, membership_role text)
language plpgsql stable security definer set search_path='' as $$
begin
 perform private.require_verified_profile();
 if not exists(select 1 from public.project_members m where m.project_id=p_project_id and m.user_id=auth.uid()) then
   raise exception 'PROJECT_MEMBER_REQUIRED';
 end if;
 return query select m.id,p.nickname,m.membership_role from public.project_members m left join public.profiles p on p.id=m.user_id
 where m.project_id=p_project_id order by (m.membership_role='owner') desc,m.joined_at,m.user_id;
end;
$$;
create or replace function public.list_project_invites(p_project_id uuid)
returns table (id uuid, status text, created_at timestamptz, expires_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
begin
 perform private.require_verified_profile();
 if not exists(select 1 from public.projects p where p.id=p_project_id and p.owner_id=auth.uid()) then raise exception 'PROJECT_OWNER_REQUIRED'; end if;
 return query select i.id,case when i.status='active' and i.expires_at<=now() then 'expired' else i.status end,i.created_at,i.expires_at
 from public.project_invitations i where i.project_id=p_project_id order by i.created_at desc,i.id desc limit 30;
end;
$$;
create or replace function public.revoke_project_invite(p_invite_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform private.require_verified_profile();
 update public.project_invitations i set status='revoked' from public.projects p where
 i.id=p_invite_id and p.id=i.project_id and p.owner_id=auth.uid() and i.status='active' and i.expires_at>now();
 if not found then raise exception 'INVITE_UNAVAILABLE'; end if;
end;
$$;
-- No campus Workspace enrollment is assumed. Add exact verified organization domains through operations after checking each school.
