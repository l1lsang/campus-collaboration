-- Legacy reboot rows intentionally keep NULL for the newly required information.
alter table public.matching_opportunities
  add column reboot_request_id uuid,
  add column reboot_prior_work text,
  add column reboot_changes text,
  add constraint matching_reboot_details check (
    (reboot_request_id is null and reboot_prior_work is null and reboot_changes is null)
    or (type = 'reboot' and reboot_request_id is not null
      and reboot_prior_work is not null and char_length(reboot_prior_work) between 2 and 2000
      and reboot_changes is not null and char_length(reboot_changes) between 2 and 2000)
  );
create unique index matching_reboot_request_idx
  on public.matching_opportunities(author_id, reboot_request_id) where reboot_request_id is not null;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('reboot-attachments', 'reboot-attachments', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png']);

-- Keep the reservation through cleanup, even if an account or its listing is removed.
-- Never delete storage.objects directly: only the Storage API removes the physical file.
create table private.matching_reboot_uploads (
  author_id uuid not null,
  request_id uuid not null,
  object_path text not null default gen_random_uuid()::text unique,
  filename text,
  created_at timestamptz not null default clock_timestamp(),
  cancelled_at timestamptz,
  opportunity_id uuid unique references public.matching_opportunities on delete set null,
  mime text check (mime in ('application/pdf', 'image/jpeg', 'image/png')),
  size integer check (size between 1 and 10485760),
  primary key (author_id, request_id),
  check (opportunity_id is null or (cancelled_at is null and filename is not null and mime is not null and size is not null))
);
alter table private.matching_reboot_uploads enable row level security;
revoke all on private.matching_reboot_uploads from public, anon, authenticated;
create index matching_reboot_upload_author_idx on private.matching_reboot_uploads(author_id, created_at);

create function private.matching_reboot_viewer() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.current_verified_university() is not null
    and exists (select 1 from public.profiles where id = auth.uid());
$$;

create function private.matching_reboot_upload_active(p_path text, p_owner text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  -- Synchronize uploads with cancellation/publication.
  perform 1 from private.matching_reboot_uploads d where d.object_path = p_path and d.author_id::text = p_owner
    and d.filename is not null and d.opportunity_id is null and d.cancelled_at is null and d.mime is null
    and d.created_at > clock_timestamp() - interval '1 hour' for share;
  return found;
end;
$$;

create function private.matching_reboot_can_upload(p_path text, p_owner text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if p_owner is distinct from auth.uid()::text or not private.matching_reboot_viewer() then return false; end if;
  return private.matching_reboot_upload_active(p_path, p_owner);
end;
$$;

-- v1.96 records the backend's actual response metadata under these camelCase
-- keys. SQL can validate those values, not file bytes stored outside Postgres.
create function private.matching_reboot_metadata_valid(p_metadata jsonb, p_filename text, p_preflight boolean) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(
    (p_metadata->>'contentEncoding') is null
    and case p_metadata->>'mimetype'
      when 'application/pdf' then p_filename ~* '\.pdf$'
      when 'image/jpeg' then p_filename ~* '\.jpe?g$'
      when 'image/png' then p_filename ~* '\.png$'
      else false
    end
    and (p_preflight or (
      p_metadata->>'cacheControl' = 'private, no-store'
      and jsonb_typeof(p_metadata->'size') = 'number'
      and p_metadata->>'size' ~ '^[1-9][0-9]{0,7}$'
      and p_metadata->'size' <= '10485760'::jsonb
    )), false);
$$;

create function private.guard_matching_reboot_storage_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_filename text;
  v_preflight boolean;
begin
  -- Use the same per-user lock as begin/cancel/publish. A concurrent begin must
  -- see either this object's committed metadata or its still-active reservation.
  select d.filename into v_filename
    from auth.users u join private.matching_reboot_uploads d on d.author_id = u.id
    where d.object_path = new.name and d.author_id::text = new.owner_id for no key update of u;
  if not found or not private.matching_reboot_upload_active(new.name, new.owner_id) then
    raise exception 'MATCHING_REBOOT_ATTEMPT_UNAVAILABLE' using errcode = '42501';
  end if;
  -- Storage v1.96's rolled-back caller RLS probe uses version '1' without size.
  -- The transaction that publishes real metadata must never use that exemption.
  v_preflight := coalesce(new.version = '1' and current_setting('role', true) = 'authenticated'
    and storage.allow_only_operation('storage.object.upload') and not (new.metadata ? 'size'), false);
  if not private.matching_reboot_metadata_valid(new.metadata, v_filename, v_preflight) then
    raise exception 'MATCHING_REBOOT_INVALID_FILE' using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger matching_reboot_storage_insert_guard before insert on storage.objects
  for each row when (new.bucket_id = 'reboot-attachments') execute function private.guard_matching_reboot_storage_insert();

create function private.matching_reboot_can_download(p_path text, p_owner text) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.matching_reboot_viewer() and exists (
    select 1 from private.matching_reboot_uploads d join public.matching_opportunities o on o.id = d.opportunity_id
    where d.object_path = p_path and d.author_id::text = p_owner and o.author_id = d.author_id
      and o.type = 'reboot' and (o.closed_at is null or o.author_id = auth.uid())
  );
$$;

create function private.matching_reboot_can_cleanup(p_path text, p_owner text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or p_owner is distinct from auth.uid()::text then return false; end if;
  -- Lock and recheck: an in-flight publication must not race an expiry-based delete.
  perform 1 from private.matching_reboot_uploads d where d.author_id = auth.uid() and d.object_path = p_path
    and d.opportunity_id is null and (d.cancelled_at is not null or d.mime is not null or d.created_at <= clock_timestamp() - interval '1 hour')
    for share;
  return found;
end;
$$;

revoke all on function private.matching_reboot_viewer(), private.matching_reboot_can_upload(text,text),
  private.matching_reboot_upload_active(text,text), private.guard_matching_reboot_storage_insert(),
  private.matching_reboot_metadata_valid(jsonb,text,boolean),
  private.matching_reboot_can_download(text,text), private.matching_reboot_can_cleanup(text,text) from public, anon, authenticated;
grant execute on function private.matching_reboot_can_upload(text,text), private.matching_reboot_can_download(text,text),
  private.matching_reboot_can_cleanup(text,text) to authenticated;

create policy matching_reboot_storage_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'reboot-attachments' and storage.allow_only_operation('storage.object.upload')
  and private.matching_reboot_can_upload(name, owner_id)
);
-- No public reads, signed URLs, listing, transforms, upserts, moves, or replacements.
create policy matching_reboot_storage_read on storage.objects for select to authenticated using (
  bucket_id = 'reboot-attachments' and storage.allow_only_operation('storage.object.get_authenticated')
  -- v1.96 places the raw URL including its query in request.path. Allow exactly
  -- the renderer's attachment-only flag: no inline route, filename override,
  -- duplicate parameters or version overrides.
  and current_setting('request.path', true) in (
    '/object/reboot-attachments/' || name || '?download=',
    '/object/authenticated/reboot-attachments/' || name || '?download='
  )
  and private.matching_reboot_can_download(name, owner_id)
);
-- Storage delete also performs a SELECT. The owner may see an abandoned object only in a delete operation.
create policy matching_reboot_storage_cleanup_read on storage.objects for select to authenticated using (
  bucket_id = 'reboot-attachments' and storage.allow_any_operation(array['storage.object.delete', 'storage.object.delete_many'])
  and private.matching_reboot_can_cleanup(name, owner_id)
);
create policy matching_reboot_storage_delete on storage.objects for delete to authenticated using (
  bucket_id = 'reboot-attachments' and storage.allow_any_operation(array['storage.object.delete', 'storage.object.delete_many'])
  and private.matching_reboot_can_cleanup(name, owner_id)
);

-- Serialize callers before checking the hourly cap or writing a new attempt.
-- Retain cancellation tombstones for one day; never prune a record that still
-- tracks a real object. This caps empty rows without preventing known cancels.
create function private.check_matching_reboot_attempt_limit(p_author uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from private.matching_reboot_uploads d where d.author_id = p_author
    and d.created_at > clock_timestamp() - interval '1 hour') >= 30 then
    raise exception 'MATCHING_REBOOT_UPLOAD_LIMIT';
  end if;
  delete from private.matching_reboot_uploads d where d.author_id = p_author and d.opportunity_id is null
    and greatest(d.created_at, d.cancelled_at) < clock_timestamp() - interval '1 day' and not exists (
      select 1 from storage.objects s where s.bucket_id = 'reboot-attachments' and s.name = d.object_path
    );
end;
$$;
revoke all on function private.check_matching_reboot_attempt_limit(uuid) from public, anon, authenticated;

create function public.begin_matching_reboot(p_request_id uuid, p_filename text default null) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_author uuid := auth.uid();
  v_name text := private.matching_trim(p_filename);
  v_draft private.matching_reboot_uploads%rowtype;
  v_pending bigint;
  v_total bigint;
  v_now timestamptz;
begin
  perform private.require_verified_profile();
  if p_request_id is null then raise exception 'MATCHING_REBOOT_ATTEMPT_UNAVAILABLE'; end if;
  if v_name is not null and (
    char_length(v_name) > 120 or v_name !~* '^.+\.(pdf|jpe?g|png)$'
    or v_name ~ '[[:cntrl:]/\\:*?"<>|]' or v_name ~ U&'[\061C\200E\200F\202A-\202E\2066-\2069]'
  ) then raise exception 'MATCHING_REBOOT_INVALID_FILENAME'; end if;

  perform 1 from auth.users where id = v_author for no key update;
  if not found or exists(select 1 from public.matching_opportunities o where o.author_id = v_author and o.reboot_request_id = p_request_id) then
    raise exception 'MATCHING_REBOOT_ATTEMPT_UNAVAILABLE';
  end if;
  select d.* into v_draft from private.matching_reboot_uploads d where d.author_id = v_author and d.request_id = p_request_id;
  if found then
    if v_draft.cancelled_at is not null or v_draft.mime is not null or v_draft.created_at <= clock_timestamp() - interval '1 hour'
      or v_draft.filename is distinct from v_name then raise exception 'MATCHING_REBOOT_ATTEMPT_UNAVAILABLE'; end if;
  else
    perform private.check_matching_reboot_attempt_limit(v_author);
    if v_name is not null then
      v_now := clock_timestamp();
      -- Each physical object or valid reservation occupies one slot. Count
      -- cancelled/expired objects until the Storage API actually removes them.
      select count(*) filter (where d.opportunity_id is null), count(*) into v_pending, v_total
        from private.matching_reboot_uploads d
        left join storage.objects s on s.bucket_id = 'reboot-attachments' and s.name = d.object_path
        where d.author_id = v_author and d.filename is not null
          and (s.id is not null or (d.opportunity_id is null and d.cancelled_at is null and d.mime is null
            and d.created_at > v_now - interval '1 hour'));
      if v_total >= 50 then raise exception 'MATCHING_REBOOT_STORAGE_LIMIT'; end if;
      if v_pending >= 5 then raise exception 'MATCHING_REBOOT_PENDING_LIMIT'; end if;
    end if;
    insert into private.matching_reboot_uploads(author_id, request_id, filename)
    values (v_author, p_request_id, v_name) returning * into v_draft;
  end if;
  return case when v_name is not null then v_draft.object_path end;
end;
$$;

create function public.cancel_matching_reboot_attempt(p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_author uuid := auth.uid();
  v_published uuid;
  v_path text;
begin
  perform 1 from auth.users where id = v_author for no key update;
  if not found or p_request_id is null then raise exception 'MATCHING_REBOOT_ATTEMPT_UNAVAILABLE'; end if;
  select o.id into v_published from public.matching_opportunities o
    where o.author_id = v_author and o.reboot_request_id = p_request_id;
  if found then return jsonb_build_object('opportunity_id', v_published); end if;
  update private.matching_reboot_uploads d set cancelled_at = coalesce(d.cancelled_at, clock_timestamp())
    where d.author_id = v_author and d.request_id = p_request_id and d.opportunity_id is null
    returning case when d.filename is not null then d.object_path end into v_path;
  if not found then
    -- Cancellation can win the race with begin. Persist that outcome before
    -- acknowledging cancellation, and do not acknowledge when at the rate cap.
    if not private.matching_reboot_viewer() then raise exception 'MATCHING_REBOOT_ATTEMPT_UNAVAILABLE'; end if;
    perform private.check_matching_reboot_attempt_limit(v_author);
    insert into private.matching_reboot_uploads(author_id, request_id, cancelled_at)
      values (v_author, p_request_id, clock_timestamp());
  end if;
  return jsonb_build_object('object_path', v_path);
end;
$$;

create function public.list_matching_reboot_cleanup() returns text[]
language sql stable security definer set search_path = '' as $$
  select array(select d.object_path from private.matching_reboot_uploads d
    join storage.objects s on s.bucket_id = 'reboot-attachments' and s.name = d.object_path and s.owner_id = d.author_id::text
    where d.author_id = auth.uid() and d.opportunity_id is null and (d.cancelled_at is not null or d.mime is not null or d.created_at <= now() - interval '1 hour')
    order by d.created_at limit 30);
$$;

-- Admin runbook (no scheduler required): periodically query NON-published files
-- over a day old, including files left by deleted accounts/listings:
--   select s.name from storage.objects s join private.matching_reboot_uploads d
--     on s.name = d.object_path and s.owner_id = d.author_id::text
--   where s.bucket_id = 'reboot-attachments' and d.opportunity_id is null
--     and d.created_at < now() - interval '1 day' order by d.created_at limit 100;
-- Delete those names via Storage API remove(), then confirm the objects are gone.
-- Keep published files (including closed listings); never SQL-delete Storage rows.

revoke all on function public.begin_matching_reboot(uuid,text), public.cancel_matching_reboot_attempt(uuid),
  public.list_matching_reboot_cleanup() from public, anon, authenticated;
grant execute on function public.begin_matching_reboot(uuid,text), public.cancel_matching_reboot_attempt(uuid),
  public.list_matching_reboot_cleanup() to authenticated;

drop function public.create_matching_opportunity(text,text,text,text[],text[],uuid,text,text,uuid,text,text,timestamptz);
create function public.create_matching_opportunity(
  p_type text, p_title text, p_description text, p_roles text[], p_skills text[] default '{}',
  p_university_id uuid default null, p_major text default null, p_gap text default null,
  p_source_project_id uuid default null, p_competition text default null, p_format text default null,
  p_deadline timestamptz default null, p_reboot_prior_work text default null,
  p_reboot_changes text default null, p_reboot_request_id uuid default null,
  p_reboot_has_attachment boolean default false
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
  v_prior text := private.matching_trim(p_reboot_prior_work);
  v_changes text := private.matching_trim(p_reboot_changes);
  v_draft private.matching_reboot_uploads%rowtype;
  v_metadata jsonb;
begin
  perform private.require_verified_profile();
  if v_title is null or char_length(v_title) not between 2 and 100
      or v_description is null or char_length(v_description) not between 10 and 4000
      or char_length(v_major) > 80 or not private.valid_tags(v_roles)
      or (cardinality(v_skills) > 0 and not private.valid_tags(v_skills)) then
    raise exception 'MATCHING_INVALID_DETAILS';
  end if;
  if p_type is null or p_type not in ('idea', 'reboot', 'contest')
    or (p_type <> 'reboot' and (v_prior is not null or v_changes is not null or p_reboot_request_id is not null or p_reboot_has_attachment))
    or (p_type = 'idea' and (v_gap is null or char_length(v_gap) not between 2 and 1000 or p_source_project_id is not null or v_competition is not null or p_format is not null or p_deadline is not null))
    or (p_type = 'reboot' and (v_gap is not null or v_competition is not null or p_format is not null or p_deadline is not null))
    or (p_type = 'contest' and (v_gap is not null or p_source_project_id is not null or v_competition is null or char_length(v_competition) not between 2 and 100 or p_format is null or p_format not in ('online','offline','hybrid') or p_deadline is null or not isfinite(p_deadline) or p_deadline <= clock_timestamp())) then
    raise exception 'MATCHING_INVALID_TYPE_FIELDS';
  end if;
  if p_university_id is not null and not exists (select 1 from public.universities u where u.id = p_university_id and u.is_active) then
    raise exception 'MATCHING_INVALID_UNIVERSITY';
  end if;
  -- A retry is scoped to the current author; it doesn't consume another rate-limit slot.
  perform 1 from auth.users where id = v_author for no key update;
  if p_type = 'reboot' then
    select o.id into v_id from public.matching_opportunities o
      where o.author_id = v_author and o.reboot_request_id = p_reboot_request_id;
    if found then return v_id; end if;
  end if;
  if (select count(*) from public.matching_opportunities o where o.author_id = v_author and o.created_at > now() - interval '1 day') >= 20 then
    raise exception 'MATCHING_RATE_LIMIT';
  end if;
  if p_type = 'reboot' and p_source_project_id is not null then
    perform 1 from public.projects p where p.id = p_source_project_id and p.visibility = 'public'
      and p.status in ('paused', 'completed', 'archived') for share;
    if not found then raise exception 'MATCHING_REBOOT_SOURCE_UNAVAILABLE'; end if;
  end if;
  if p_type = 'reboot' and (p_reboot_request_id is null or v_prior is null or v_changes is null
    or char_length(v_prior) not between 2 and 2000 or char_length(v_changes) not between 2 and 2000) then
    raise exception 'MATCHING_REBOOT_DETAILS_REQUIRED';
  end if;
  if p_type = 'reboot' then
    select d.* into v_draft from private.matching_reboot_uploads d
      where d.author_id = v_author and d.request_id = p_reboot_request_id for update;
    if not found or v_draft.cancelled_at is not null or v_draft.mime is not null or v_draft.opportunity_id is not null
      or v_draft.created_at <= clock_timestamp() - interval '1 hour' then
      raise exception 'MATCHING_REBOOT_ATTEMPT_UNAVAILABLE';
    end if;
    if (v_draft.filename is not null) <> coalesce(p_reboot_has_attachment, false) then
      raise exception 'MATCHING_REBOOT_ATTACHMENT_UNAVAILABLE';
    end if;
    if p_reboot_has_attachment then
      select s.metadata into v_metadata from storage.objects s
        where s.bucket_id = 'reboot-attachments' and s.name = v_draft.object_path and s.owner_id = v_author::text;
      if not found then raise exception 'MATCHING_REBOOT_ATTACHMENT_UNAVAILABLE'; end if;
      if not private.matching_reboot_metadata_valid(v_metadata, v_draft.filename, false) then
        raise exception 'MATCHING_REBOOT_INVALID_FILE';
      end if;
    end if;
  end if;
  insert into public.matching_opportunities(type, author_id, title, description, roles, skills, university_id, major, gap, source_project_id, competition, format, deadline, reboot_request_id, reboot_prior_work, reboot_changes)
  values(p_type, v_author, v_title, v_description, v_roles, v_skills, p_university_id, v_major, v_gap, p_source_project_id, v_competition, p_format, p_deadline, p_reboot_request_id, v_prior, v_changes)
  returning id into v_id;
  if p_reboot_has_attachment then
    update private.matching_reboot_uploads set opportunity_id = v_id,
      mime = v_metadata->>'mimetype', size = (v_metadata->>'size')::integer
      where author_id = v_author and request_id = p_reboot_request_id;
  end if;
  return v_id;
end;
$$;
revoke all on function public.create_matching_opportunity(text,text,text,text[],text[],uuid,text,text,uuid,text,text,timestamptz,text,text,uuid,boolean) from public, anon, authenticated;
grant execute on function public.create_matching_opportunity(text,text,text,text[],text[],uuid,text,text,uuid,text,text,timestamptz,text,text,uuid,boolean) to authenticated;

drop function public.list_matching_opportunities(text,boolean,uuid,text,text,text,text,text,integer);
create function public.list_matching_opportunities(
  p_type text default null, p_mine boolean default false, p_university_id uuid default null,
  p_major text default null, p_skill text default null, p_role text default null,
  p_competition text default null, p_format text default null, p_offset integer default 0
) returns table (
  id uuid, type text, title text, description text, roles text[], skills text[], university_name text, major text,
  gap text, source_project_id uuid, competition text, format text, deadline timestamptz,
  is_mine boolean, is_open boolean, request_status text, project_id uuid,
  reboot_prior_work text, reboot_changes text, reboot_attachment jsonb
) language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid := auth.uid();
begin
  perform private.require_verified_profile();
  return query
    select o.id, o.type, o.title, o.description, o.roles, o.skills, u.name, o.major,
      o.gap, source.id, o.competition, o.format, o.deadline, o.author_id = v_user,
      o.closed_at is null and (o.deadline is null or o.deadline > now()), r.status,
      case when m.user_id is not null then o.project_id end,
      o.reboot_prior_work, o.reboot_changes,
      case when d.opportunity_id is not null then jsonb_build_object(
        'path', d.object_path, 'filename', d.filename, 'mime', d.mime, 'size', d.size) end
    from public.matching_opportunities o
    left join public.universities u on u.id = o.university_id
    left join public.projects source on source.id = o.source_project_id and source.visibility = 'public'
    left join public.matching_requests r on r.opportunity_id = o.id and r.applicant_id = v_user
    left join public.project_members m on m.project_id = o.project_id and m.user_id = v_user
    left join private.matching_reboot_uploads d on d.opportunity_id = o.id and d.author_id = o.author_id
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
revoke all on function public.list_matching_opportunities(text,boolean,uuid,text,text,text,text,text,integer) from public, anon, authenticated;
grant execute on function public.list_matching_opportunities(text,boolean,uuid,text,text,text,text,text,integer) to authenticated;
