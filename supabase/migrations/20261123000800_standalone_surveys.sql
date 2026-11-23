-- Existing recruitments remain project tests, and project-test publication still requires an owned project.
alter table public.research_tests
  alter column project_id drop not null,
  add column kind text not null default 'project_test',
  add constraint research_tests_kind_check check (
    (kind = 'project_test' and project_id is not null) or kind = 'survey'
  );

create function private.publish_research_recruitment(
  p_kind text, p_request_id uuid, p_project_id uuid, p_title text, p_description text,
  p_test_url text, p_capacity integer, p_reward integer
) returns uuid language plpgsql set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_title text := regexp_replace(p_title, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  v_description text := regexp_replace(p_description, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  v_url text := btrim(p_test_url);
  v_url_match text[];
  v_test public.research_tests%rowtype;
  v_available bigint;
  v_cost integer;
  v_id uuid;
begin
  perform private.require_verified_profile();
  if (p_kind = 'project_test' or p_project_id is not null) and not exists (
    select 1 from public.projects p where p.id = p_project_id and p.owner_id = v_user
  ) then
    raise exception 'RESEARCH_PROJECT_OWNER_REQUIRED';
  end if;
  -- The browser converts Unicode hosts to ASCII A-labels. Validate that wire format here.
  v_url_match := regexp_match(v_url collate "C",
    '^https://([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+)(?::([0-9]{1,5}))?(?:[/?#]|$)', 'i');
  if p_request_id is null or v_title is null or char_length(v_title) not between 2 and 100
    or v_description is null or char_length(v_description) not between 10 and 2000
    or v_url is null or char_length(v_url) > 2000
    or v_url collate "C" ~ U&'[\0001-\0020\007F-\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]'
    or strpos(v_url, chr(92)) > 0
    or v_url_match is null or char_length(v_url_match[1]) > 253
    or v_url_match[1] collate "C" ~* '(?:^|\.)xn--[a-z0-9](?:\.|$)|\.(?:localhost|[0-9]+|0x[0-9a-f]*)$'
    or coalesce(v_url_match[2]::integer, 0) > 65535
    or p_capacity is null or p_capacity not between 1 and 20 or p_reward is null or p_reward not between 1 and 10 then
    raise exception 'RESEARCH_INVALID_DETAILS';
  end if;
  v_cost := p_capacity * p_reward;
  perform private.ensure_research_credit_account(v_user);
  select a.available into v_available from public.research_credit_accounts a where a.user_id = v_user for update;
  select t.* into v_test from public.research_tests t where t.organizer_id = v_user and t.request_id = p_request_id;
  if found then
    if row(v_test.kind, v_test.project_id, v_test.title, v_test.description, v_test.test_url, v_test.capacity, v_test.reward)
      is distinct from row(p_kind, p_project_id, v_title, v_description, v_url, p_capacity, p_reward) then
      raise exception 'RESEARCH_REQUEST_CONFLICT';
    end if;
    return v_test.id;
  end if;
  if v_available < v_cost then raise exception 'RESEARCH_INSUFFICIENT_CREDITS'; end if;

  insert into public.research_tests(kind, project_id, organizer_id, request_id, title, description, test_url, capacity, reward, reserved_remaining)
    values (p_kind, p_project_id, v_user, p_request_id, v_title, v_description, v_url, p_capacity, p_reward, v_cost)
    returning id into v_id;
  update public.research_credit_accounts set available = available - v_cost, reserved = reserved + v_cost where user_id = v_user;
  insert into public.research_credit_ledger(user_id, kind, test_id, available_delta, reserved_delta)
    values (v_user, 'reserve', v_id, -v_cost, v_cost);
  return v_id;
end;
$$;
revoke all on function private.publish_research_recruitment(text,uuid,uuid,text,text,text,integer,integer) from public, anon, authenticated;

create or replace function public.publish_research_test(
  p_request_id uuid, p_project_id uuid, p_title text, p_description text,
  p_test_url text, p_capacity integer, p_reward integer
) returns uuid language sql security definer set search_path = '' as $$
  select private.publish_research_recruitment(
    'project_test', p_request_id, p_project_id, p_title, p_description, p_test_url, p_capacity, p_reward
  )
$$;

create function public.publish_research_survey(
  p_request_id uuid, p_project_id uuid, p_title text, p_description text,
  p_test_url text, p_capacity integer, p_reward integer
) returns uuid language sql security definer set search_path = '' as $$
  select private.publish_research_recruitment(
    'survey', p_request_id, p_project_id, p_title, p_description, p_test_url, p_capacity, p_reward
  )
$$;
revoke all on function public.publish_research_survey(uuid,uuid,text,text,text,integer,integer) from public, anon, authenticated;
grant execute on function public.publish_research_survey(uuid,uuid,text,text,text,integer,integer) to authenticated;

alter table public.research_participations
  add column survey_attested boolean not null default false,
  add column rejected_at timestamptz,
  add column confirmation_code uuid unique,
  drop constraint research_participations_check,
  add constraint research_participations_submission_check check (
    (feedback is not null or survey_attested) = (submitted_at is not null)
    and (not survey_attested or feedback is null)
  ),
  add constraint research_participations_rejection_check check (
    rejected_at is null or (survey_attested and submitted_at is not null and confirmed_at is null)
  );

create or replace function public.apply_research_test(p_test_id uuid) returns uuid
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
  -- Only new standalone survey applications receive an identifier for manual matching.
  insert into public.research_participations(test_id, participant_id, confirmation_code)
    values (p_test_id, v_user, case when v_test.kind = 'survey' and v_test.project_id is null then gen_random_uuid() end)
    returning id into v_id;
  update public.research_tests set applied_count = applied_count + 1 where id = p_test_id;
  return v_id;
end;
$$;

create function private.submit_research_participation(p_kind text, p_test_id uuid, p_feedback text) returns void
language plpgsql set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_feedback text := regexp_replace(p_feedback, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  v_kind text;
  v_entry public.research_participations%rowtype;
begin
  perform private.require_verified_profile();
  if p_kind = 'project_test' and (v_feedback is null or char_length(v_feedback) not between 10 and 3000) then
    raise exception 'RESEARCH_INVALID_FEEDBACK';
  end if;
  select t.kind into v_kind from public.research_tests t where t.id = p_test_id and t.closed_at is null for update;
  if not found then raise exception 'RESEARCH_TEST_UNAVAILABLE'; end if;
  if v_kind <> p_kind then raise exception 'RESEARCH_WRONG_KIND'; end if;
  select p.* into v_entry from public.research_participations p
    where p.test_id = p_test_id and p.participant_id = v_user for update;
  if not found then raise exception 'RESEARCH_APPLICATION_REQUIRED'; end if;
  if v_entry.rejected_at is not null then raise exception 'RESEARCH_PARTICIPATION_REJECTED'; end if;
  if v_entry.submitted_at is not null then
    if p_kind = 'survey' or v_entry.feedback = v_feedback then return; end if;
    raise exception 'RESEARCH_FEEDBACK_ALREADY_SUBMITTED';
  end if;
  -- A survey submission is only the participant's self-report, never a form response or automatic verification.
  update public.research_participations
    set feedback = v_feedback, survey_attested = (p_kind = 'survey'), submitted_at = now()
    where id = v_entry.id;
end;
$$;
revoke all on function private.submit_research_participation(text,uuid,text) from public, anon, authenticated;

create or replace function public.submit_research_feedback(p_test_id uuid, p_feedback text) returns void
language sql security definer set search_path = '' as $$
  select private.submit_research_participation('project_test', p_test_id, p_feedback)
$$;

create function public.submit_research_survey_completion(p_test_id uuid) returns void
language sql security definer set search_path = '' as $$
  select private.submit_research_participation('survey', p_test_id, null)
$$;
revoke all on function public.submit_research_survey_completion(uuid) from public, anon, authenticated;
grant execute on function public.submit_research_survey_completion(uuid) to authenticated;

-- Serialize rejection, confirmation, submission and close on the recruitment row first.
create function public.reject_research_survey_completion(p_participation_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_test public.research_tests%rowtype;
  v_entry public.research_participations%rowtype;
begin
  perform private.require_verified_profile();
  select t.* into v_test from public.research_tests t join public.research_participations p on p.test_id = t.id
    where p.id = p_participation_id and t.organizer_id = auth.uid() for update of t;
  if not found then raise exception 'RESEARCH_TEST_UNAVAILABLE'; end if;
  if v_test.kind <> 'survey' then raise exception 'RESEARCH_WRONG_KIND'; end if;
  select p.* into v_entry from public.research_participations p where p.id = p_participation_id for update;
  if v_entry.rejected_at is not null then return; end if;
  if v_test.closed_at is not null then raise exception 'RESEARCH_TEST_UNAVAILABLE'; end if;
  if v_entry.confirmed_at is not null then raise exception 'RESEARCH_PARTICIPATION_ALREADY_CONFIRMED'; end if;
  if not v_entry.survey_attested then raise exception 'RESEARCH_SURVEY_COMPLETION_REQUIRED'; end if;

  -- Keep the original claim and slot. Only closing returns unpaid credits.
  update public.research_participations set rejected_at = now() where id = p_participation_id;
end;
$$;
revoke all on function public.reject_research_survey_completion(uuid) from public, anon, authenticated;
grant execute on function public.reject_research_survey_completion(uuid) to authenticated;

create or replace function public.confirm_research_participation(p_participation_id uuid) returns void
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
  select p.* into v_entry from public.research_participations p where p.id = p_participation_id for update;
  if v_entry.confirmed_at is not null then return; end if;
  if v_entry.rejected_at is not null then raise exception 'RESEARCH_PARTICIPATION_REJECTED'; end if;
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

create or replace function public.close_research_test(p_test_id uuid) returns void
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
     and p.submitted_at is not null and p.confirmed_at is null and p.rejected_at is null) then
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

-- Public summaries expose the recruitment kind, not the linked project or form details.
drop function public.list_research_tests();
create function public.list_research_tests()
returns table (id uuid, title text, description text, capacity integer, slots_left integer, reward integer, kind text)
language sql stable security definer set search_path = '' as $$
  select t.id, t.title, t.description, t.capacity, t.capacity - t.applied_count, t.reward, t.kind
  from public.research_tests t where t.closed_at is null
  order by t.created_at desc, t.id desc limit 100
$$;
revoke all on function public.list_research_tests() from public, anon, authenticated;
grant execute on function public.list_research_tests() to anon, authenticated;

create or replace function public.my_research_work() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid := auth.uid();
begin
  perform private.require_verified_profile();
  return jsonb_build_object(
    'organized', coalesce((select jsonb_agg(jsonb_build_object(
      'id', t.id, 'title', t.title, 'capacity', t.capacity, 'slots_left', t.capacity - t.applied_count,
      'reward', t.reward, 'reserved_remaining', t.reserved_remaining, 'kind', t.kind,
      'status', case when t.closed_at is null then 'open' else 'closed' end,
      'participants', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'nickname', profile.nickname, 'feedback', p.feedback,
        'confirmation_code', case when p.survey_attested then p.confirmation_code end,
        'status', case when p.confirmed_at is not null then 'confirmed' when p.rejected_at is not null then 'rejected'
          when p.submitted_at is not null then 'submitted' else 'applied' end
      ) order by p.applied_at, p.id) from public.research_participations p
        left join public.profiles profile on profile.id = p.participant_id
        where p.test_id = t.id), '[]'::jsonb)
    ) order by (t.closed_at is null) desc, t.created_at desc, t.id desc)
    from public.research_tests t where t.organizer_id = v_user), '[]'::jsonb),
    'participating', coalesce((select jsonb_agg(jsonb_build_object(
      'id', p.id, 'test_id', t.id, 'title', t.title, 'description', t.description, 'reward', t.reward, 'kind', t.kind,
      'test_url', case when t.closed_at is null and p.rejected_at is null then t.test_url end,
      'confirmation_code', p.confirmation_code,
      'test_status', case when t.closed_at is null then 'open' else 'closed' end,
      'status', case when p.confirmed_at is not null then 'confirmed' when p.rejected_at is not null then 'rejected'
        when p.submitted_at is not null then 'submitted' else 'applied' end
    ) order by (t.closed_at is null) desc, p.applied_at desc, p.id desc)
    from public.research_participations p join public.research_tests t on t.id = p.test_id
    where p.participant_id = v_user), '[]'::jsonb)
  );
end;
$$;
