-- Research credits are internal, non-cash and server-managed. Clients only use scoped RPCs.
create table public.research_credit_accounts (
  user_id uuid primary key references auth.users on delete restrict,
  available bigint not null check (available >= 0),
  reserved bigint not null default 0 check (reserved >= 0)
);

create table public.research_tests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects on delete restrict,
  organizer_id uuid not null references public.research_credit_accounts(user_id) on delete restrict,
  request_id uuid not null,
  title text not null check (char_length(title) between 2 and 100),
  description text not null check (char_length(description) between 10 and 2000),
  test_url text not null check (char_length(test_url) <= 2000),
  capacity integer not null check (capacity between 1 and 20),
  reward integer not null check (reward between 1 and 10),
  applied_count integer not null default 0 check (applied_count between 0 and capacity),
  reserved_remaining integer not null check (reserved_remaining between 0 and capacity * reward),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  check (closed_at is null or reserved_remaining = 0),
  unique (organizer_id, request_id)
);
create index research_tests_open_idx on public.research_tests(created_at desc, id desc) where closed_at is null;
create index research_tests_project_idx on public.research_tests(project_id);

create table public.research_participations (
  id uuid primary key default gen_random_uuid(),
  test_id uuid not null references public.research_tests on delete restrict,
  participant_id uuid not null references public.research_credit_accounts(user_id) on delete restrict,
  feedback text check (char_length(feedback) between 10 and 3000),
  applied_at timestamptz not null default now(),
  submitted_at timestamptz,
  confirmed_at timestamptz,
  check ((feedback is null) = (submitted_at is null)),
  check (confirmed_at is null or submitted_at is not null),
  unique (test_id, participant_id),
  unique (id, test_id)
);
create index research_participations_participant_idx on public.research_participations(participant_id, applied_at desc);

create table public.research_credit_ledger (
  sequence bigint generated always as identity primary key,
  user_id uuid not null references public.research_credit_accounts(user_id) on delete restrict,
  kind text not null,
  test_id uuid references public.research_tests on delete restrict,
  participation_id uuid,
  available_delta bigint not null,
  reserved_delta bigint not null,
  created_at timestamptz not null default now(),
  foreign key (participation_id, test_id) references public.research_participations(id, test_id) on delete restrict,
  check (
    (kind = 'starter' and test_id is null and participation_id is null and available_delta = 3 and reserved_delta = 0)
    or (kind = 'reserve' and test_id is not null and participation_id is null and available_delta < 0 and reserved_delta = -available_delta)
    or (kind = 'release' and test_id is not null and participation_id is null and available_delta > 0 and reserved_delta = -available_delta)
    or (kind = 'spend' and test_id is not null and participation_id is not null and available_delta = 0 and reserved_delta < 0)
    or (kind = 'award' and test_id is not null and participation_id is not null and available_delta > 0 and reserved_delta = 0)
  )
);
create index research_ledger_user_idx on public.research_credit_ledger(user_id, sequence desc);
create index research_ledger_test_idx on public.research_credit_ledger(test_id);
create unique index research_ledger_starter_once on public.research_credit_ledger(user_id) where kind = 'starter';
create unique index research_ledger_test_once on public.research_credit_ledger(test_id, kind) where kind in ('reserve', 'release');
create unique index research_ledger_participation_once on public.research_credit_ledger(participation_id, kind) where kind in ('spend', 'award');

alter table public.research_credit_accounts enable row level security;
alter table public.research_tests enable row level security;
alter table public.research_participations enable row level security;
alter table public.research_credit_ledger enable row level security;
-- Default deny: even public summaries are read through an allowlisted projection, not a table grant.
revoke all on public.research_credit_accounts, public.research_tests, public.research_participations,
  public.research_credit_ledger from public, anon, authenticated;
revoke all on sequence public.research_credit_ledger_sequence_seq from public, anon, authenticated;

create function private.ensure_research_credit_account(p_user_id uuid) returns void
language plpgsql set search_path = '' as $$
begin
  -- Bootstrap once on first successful publication, application or ledger view.
  insert into public.research_credit_accounts(user_id, available) values (p_user_id, 3)
    on conflict (user_id) do nothing;
  if found then
    insert into public.research_credit_ledger(user_id, kind, available_delta, reserved_delta)
      values (p_user_id, 'starter', 3, 0);
  end if;
end;
$$;
revoke all on function private.ensure_research_credit_account(uuid) from public, anon, authenticated;

create function public.list_research_tests()
returns table (id uuid, title text, description text, capacity integer, slots_left integer, reward integer)
language sql stable security definer set search_path = '' as $$
  select t.id, t.title, t.description, t.capacity, t.capacity - t.applied_count, t.reward
  from public.research_tests t where t.closed_at is null
  order by t.created_at desc, t.id desc limit 100
$$;

create function public.publish_research_test(
  p_request_id uuid, p_project_id uuid, p_title text, p_description text,
  p_test_url text, p_capacity integer, p_reward integer
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_title text := regexp_replace(p_title, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  v_description text := regexp_replace(p_description, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  v_url text := btrim(p_test_url);
  v_test public.research_tests%rowtype;
  v_available bigint;
  v_cost integer;
  v_id uuid;
begin
  perform private.require_verified_profile();
  if not exists (select 1 from public.projects p where p.id = p_project_id and p.owner_id = v_user) then
    raise exception 'RESEARCH_PROJECT_OWNER_REQUIRED';
  end if;
  if p_request_id is null or v_title is null or char_length(v_title) not between 2 and 100
    or v_description is null or char_length(v_description) not between 10 and 2000
    or v_url is null or char_length(v_url) > 2000 or v_url ~ '[[:space:][:cntrl:]]'
    or strpos(v_url, chr(92)) > 0
    or v_url !~* '^https://[a-z0-9-]+(\.[a-z0-9-]+)+(:[0-9]{1,5})?([/?#]|$)'
    or p_capacity is null or p_capacity not between 1 and 20 or p_reward is null or p_reward not between 1 and 10 then
    raise exception 'RESEARCH_INVALID_DETAILS';
  end if;
  v_cost := p_capacity * p_reward;
  perform private.ensure_research_credit_account(v_user);
  select a.available into v_available from public.research_credit_accounts a where a.user_id = v_user for update;
  select t.* into v_test from public.research_tests t where t.organizer_id = v_user and t.request_id = p_request_id;
  if found then
    if row(v_test.project_id, v_test.title, v_test.description, v_test.test_url, v_test.capacity, v_test.reward)
      is distinct from row(p_project_id, v_title, v_description, v_url, p_capacity, p_reward) then
      raise exception 'RESEARCH_REQUEST_CONFLICT';
    end if;
    return v_test.id;
  end if;
  if v_available < v_cost then raise exception 'RESEARCH_INSUFFICIENT_CREDITS'; end if;

  insert into public.research_tests(project_id, organizer_id, request_id, title, description, test_url, capacity, reward, reserved_remaining)
    values (p_project_id, v_user, p_request_id, v_title, v_description, v_url, p_capacity, p_reward, v_cost)
    returning id into v_id;
  update public.research_credit_accounts set available = available - v_cost, reserved = reserved + v_cost where user_id = v_user;
  insert into public.research_credit_ledger(user_id, kind, test_id, available_delta, reserved_delta)
    values (v_user, 'reserve', v_id, -v_cost, v_cost);
  return v_id;
end;
$$;

create function public.apply_research_test(p_test_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_test public.research_tests%rowtype;
  v_id uuid;
begin
  perform private.require_verified_profile();
  -- Serialize all slot and status changes on the test, before touching accounts.
  select t.* into v_test from public.research_tests t where t.id = p_test_id for update;
  if not found or v_test.closed_at is not null then raise exception 'RESEARCH_TEST_UNAVAILABLE'; end if;
  if v_test.organizer_id = v_user then raise exception 'RESEARCH_OWN_TEST'; end if;
  if exists (select 1 from public.research_participations p where p.test_id = p_test_id and p.participant_id = v_user) then
    raise exception 'RESEARCH_ALREADY_APPLIED';
  end if;
  if v_test.applied_count >= v_test.capacity then raise exception 'RESEARCH_TEST_FULL'; end if;

  perform private.ensure_research_credit_account(v_user);
  insert into public.research_participations(test_id, participant_id) values (p_test_id, v_user) returning id into v_id;
  update public.research_tests set applied_count = applied_count + 1 where id = p_test_id;
  return v_id;
end;
$$;

create function public.submit_research_feedback(p_test_id uuid, p_feedback text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_feedback text := regexp_replace(p_feedback, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  v_entry public.research_participations%rowtype;
begin
  perform private.require_verified_profile();
  if v_feedback is null or char_length(v_feedback) not between 10 and 3000 then
    raise exception 'RESEARCH_INVALID_FEEDBACK';
  end if;
  perform 1 from public.research_tests t where t.id = p_test_id and t.closed_at is null for update;
  if not found then raise exception 'RESEARCH_TEST_UNAVAILABLE'; end if;
  select p.* into v_entry from public.research_participations p where p.test_id = p_test_id and p.participant_id = v_user;
  if not found then raise exception 'RESEARCH_APPLICATION_REQUIRED'; end if;
  if v_entry.submitted_at is not null then
    if v_entry.feedback = v_feedback then return; end if;
    raise exception 'RESEARCH_FEEDBACK_ALREADY_SUBMITTED';
  end if;
  update public.research_participations set feedback = v_feedback, submitted_at = now() where id = v_entry.id;
end;
$$;

create function public.confirm_research_participation(p_participation_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_test public.research_tests%rowtype;
  v_entry public.research_participations%rowtype;
begin
  perform private.require_verified_profile();
  select t.* into v_test from public.research_tests t join public.research_participations p on p.test_id = t.id
    where p.id = p_participation_id and t.organizer_id = v_user for update of t;
  if not found then raise exception 'RESEARCH_TEST_UNAVAILABLE'; end if;
  select p.* into v_entry from public.research_participations p where p.id = p_participation_id;
  if v_entry.confirmed_at is not null then return; end if;
  if v_test.closed_at is not null then raise exception 'RESEARCH_TEST_UNAVAILABLE'; end if;
  if v_entry.submitted_at is null then raise exception 'RESEARCH_FEEDBACK_REQUIRED'; end if;

  -- Both accounts already exist. Reciprocal payouts take account locks in the same UUID order.
  perform 1 from public.research_credit_accounts a where a.user_id in (v_user, v_entry.participant_id)
    order by a.user_id for update;
  update public.research_credit_accounts set reserved = reserved - v_test.reward where user_id = v_user;
  update public.research_credit_accounts set available = available + v_test.reward where user_id = v_entry.participant_id;
  update public.research_tests set reserved_remaining = reserved_remaining - v_test.reward where id = v_test.id;
  update public.research_participations set confirmed_at = now() where id = p_participation_id;
  insert into public.research_credit_ledger(user_id, kind, test_id, participation_id, available_delta, reserved_delta) values
    (v_user, 'spend', v_test.id, p_participation_id, 0, -v_test.reward),
    (v_entry.participant_id, 'award', v_test.id, p_participation_id, v_test.reward, 0);
end;
$$;

create function public.close_research_test(p_test_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_test public.research_tests%rowtype;
begin
  perform private.require_verified_profile();
  select t.* into v_test from public.research_tests t where t.id = p_test_id and t.organizer_id = v_user for update;
  if not found then raise exception 'RESEARCH_TEST_UNAVAILABLE'; end if;
  if v_test.closed_at is not null then return; end if;
  if exists (select 1 from public.research_participations p where p.test_id = p_test_id
     and p.submitted_at is not null and p.confirmed_at is null) then
    raise exception 'RESEARCH_PENDING_FEEDBACK';
  end if;
  if v_test.reserved_remaining > 0 then
    update public.research_credit_accounts
      set available = available + v_test.reserved_remaining, reserved = reserved - v_test.reserved_remaining where user_id = v_user;
    insert into public.research_credit_ledger(user_id, kind, test_id, available_delta, reserved_delta)
      values (v_user, 'release', p_test_id, v_test.reserved_remaining, -v_test.reserved_remaining);
  end if;
  update public.research_tests set closed_at = now(), reserved_remaining = 0 where id = p_test_id;
end;
$$;

create function public.my_research_work() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid := auth.uid();
begin
  perform private.require_verified_profile();
  return jsonb_build_object(
    'organized', coalesce((select jsonb_agg(jsonb_build_object(
      'id', t.id, 'title', t.title, 'capacity', t.capacity, 'slots_left', t.capacity - t.applied_count,
      'reward', t.reward, 'reserved_remaining', t.reserved_remaining,
      'status', case when t.closed_at is null then 'open' else 'closed' end,
      'participants', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'nickname', profile.nickname, 'feedback', p.feedback,
        'status', case when p.confirmed_at is not null then 'confirmed' when p.submitted_at is not null then 'submitted' else 'applied' end
      ) order by p.applied_at, p.id) from public.research_participations p
        left join public.profiles profile on profile.id = p.participant_id
        where p.test_id = t.id), '[]'::jsonb)
    ) order by (t.closed_at is null) desc, t.created_at desc, t.id desc)
    from public.research_tests t where t.organizer_id = v_user), '[]'::jsonb),
    'participating', coalesce((select jsonb_agg(jsonb_build_object(
      'id', p.id, 'test_id', t.id, 'title', t.title, 'description', t.description, 'reward', t.reward,
      'test_url', case when t.closed_at is null then t.test_url end,
      'test_status', case when t.closed_at is null then 'open' else 'closed' end,
      'status', case when p.confirmed_at is not null then 'confirmed' when p.submitted_at is not null then 'submitted' else 'applied' end
    ) order by (t.closed_at is null) desc, p.applied_at desc, p.id desc)
    from public.research_participations p join public.research_tests t on t.id = p.test_id
    where p.participant_id = v_user), '[]'::jsonb)
  );
end;
$$;

create function public.my_research_credits(p_before_sequence bigint default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid();
begin
  perform private.require_verified_profile();
  perform private.ensure_research_credit_account(v_user);
  -- One snapshot for both current balances and the selected page; no other account IDs are returned.
  return (
    with entries as (
      select l.sequence, l.kind, l.available_delta, l.reserved_delta, l.created_at, t.title
      from public.research_credit_ledger l left join public.research_tests t on t.id = l.test_id
      where l.user_id = v_user and (p_before_sequence is null or l.sequence < p_before_sequence)
      order by l.sequence desc limit 51
    ), page as (select * from entries order by sequence desc limit 50)
    select jsonb_build_object('available', a.available, 'reserved', a.reserved,
      'entries', coalesce((select jsonb_agg(jsonb_build_object(
        'sequence', p.sequence::text, 'kind', p.kind, 'available_delta', p.available_delta,
        'reserved_delta', p.reserved_delta, 'created_at', p.created_at, 'test_title', p.title
      ) order by p.sequence desc) from page p), '[]'::jsonb),
      'next_before', case when (select count(*) from entries) > 50 then (select min(sequence)::text from page) end)
    from public.research_credit_accounts a where a.user_id = v_user
  );
end;
$$;

revoke all on function public.list_research_tests(), public.publish_research_test(uuid,uuid,text,text,text,integer,integer),
  public.apply_research_test(uuid), public.submit_research_feedback(uuid,text), public.confirm_research_participation(uuid),
  public.close_research_test(uuid), public.my_research_work(), public.my_research_credits(bigint) from public, anon, authenticated;
grant execute on function public.list_research_tests() to anon, authenticated;
grant execute on function public.publish_research_test(uuid,uuid,text,text,text,integer,integer), public.apply_research_test(uuid),
  public.submit_research_feedback(uuid,text), public.confirm_research_participation(uuid), public.close_research_test(uuid),
  public.my_research_work(), public.my_research_credits(bigint) to authenticated;
