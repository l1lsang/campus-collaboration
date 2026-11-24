begin;
set local search_path = public, extensions;
select plan(79);

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-4000-8650-000000000001','owner@lifecycle-test.example',now()),
  ('00000000-0000-4000-8650-000000000002','member@lifecycle-test.example',now()),
  ('00000000-0000-4000-8650-000000000003','other@lifecycle-test.example',now()),
  ('00000000-0000-4000-8650-000000000004','unverified@lifecycle-test.example',now()),
  ('00000000-0000-4000-8650-000000000005','no-profile@lifecycle-test.example',now()),
  ('00000000-0000-4000-8650-000000000006','late@lifecycle-test.example',now());
insert into public.universities (id, name, short_name) values
  ('00000000-0000-4000-8650-000000000010','Lifecycle verification university','Lifecycle test');
insert into public.university_email_domains (university_id, email_domain) values
  ('00000000-0000-4000-8650-000000000010','lifecycle-test.example');
insert into public.profiles (id, nickname, university_id, major, bio, skills, interests, preferred_category)
select id, 'Lifecycle tester', '00000000-0000-4000-8650-000000000010', 'Testing', 'Fixture only', '{SQL}', '{Testing}', 'side_project'
from auth.users where split_part(email,'@',2) = 'lifecycle-test.example' and email not like 'no-profile%';
insert into auth.identities (provider_id, user_id, provider, identity_data)
select id::text, id, 'google', jsonb_build_object('email',email,'email_verified',true,
  'custom_claims',jsonb_build_object('hd','lifecycle-test.example'))
from auth.users where split_part(email,'@',2) = 'lifecycle-test.example' and email not like 'unverified%';

insert into public.projects (id, owner_id, title, description, category, status, visibility, completed_at) values
  ('00000000-0000-4000-8650-000000000101','00000000-0000-4000-8650-000000000001','Active lifecycle','Project lifecycle fixture','side_project','active','private',null),
  ('00000000-0000-4000-8650-000000000102','00000000-0000-4000-8650-000000000001','Paused lifecycle','Project lifecycle fixture','side_project','paused','public','2020-01-01 UTC'),
  ('00000000-0000-4000-8650-000000000103','00000000-0000-4000-8650-000000000001','Archived lifecycle','Project lifecycle fixture','side_project','archived','public',null),
  ('00000000-0000-4000-8650-000000000104','00000000-0000-4000-8650-000000000001','Mismatched owner','Project lifecycle fixture','side_project','active','private',null),
  ('00000000-0000-4000-8650-000000000105','00000000-0000-4000-8650-000000000004','Unverified owner','Project lifecycle fixture','side_project','active','private',null),
  ('00000000-0000-4000-8650-000000000106','00000000-0000-4000-8650-000000000005','No profile owner','Project lifecycle fixture','side_project','active','private',null);
insert into public.project_members (project_id, user_id, membership_role)
select id, owner_id, 'owner' from public.projects
where id between '00000000-0000-4000-8650-000000000101' and '00000000-0000-4000-8650-000000000106'
  and id <> '00000000-0000-4000-8650-000000000104';
insert into public.project_members (project_id, user_id, membership_role) values
  ('00000000-0000-4000-8650-000000000101','00000000-0000-4000-8650-000000000002','member'),
  ('00000000-0000-4000-8650-000000000104','00000000-0000-4000-8650-000000000001','member'),
  ('00000000-0000-4000-8650-000000000104','00000000-0000-4000-8650-000000000003','owner');

select set_config('lifecycle.active', '00000000-0000-4000-8650-000000000101', true);
select set_config('lifecycle.paused', '00000000-0000-4000-8650-000000000102', true);
select set_config('lifecycle.mismatch', '00000000-0000-4000-8650-000000000104', true);
select set_config('lifecycle.missing', '00000000-0000-4000-8650-000000000109', true);

set local role authenticated;
set local request.jwt.claims = '{"amr":[{"method":"oauth"}]}';
set local request.jwt.claim.sub = '00000000-0000-4000-8650-000000000001';
-- Create real team and report data before completion so retention and cascade share one fixture.
select set_config('lifecycle.invite', i.token, true) is not null
  from public.create_project_invite(current_setting('lifecycle.active')::uuid) i;
select public.team_create_task(current_setting('lifecycle.active')::uuid, 'Lifecycle task', '', 1, null, '{}');
select public.team_open_feedback(current_setting('lifecycle.active')::uuid, 'Lifecycle feedback', now() + interval '1 day');
select public.team_submit_checkin(current_setting('lifecycle.active')::uuid, 2, 3, false);
select set_config('lifecycle.revision', public.save_project_report(current_setting('lifecycle.active')::uuid,
  'activity', 0, '{}')->>'id', true);
select set_config('lifecycle.snapshot', public.publish_project_report(current_setting('lifecycle.active')::uuid,
  'activity', current_setting('lifecycle.revision')::uuid, true,
  '{"title":"Lifecycle public snapshot","summary":"A separately published fixture"}')->>'id', true);

select lives_ok($sql$do $$begin
  if public.complete_project(p_project_id => current_setting('lifecycle.active')::uuid)
      is distinct from current_setting('lifecycle.active')::uuid then
    raise exception 'Unexpected completion UUID';
  end if;
end$$$sql$, 'verified owner completes an active project and receives its UUID');
select is((select status from public.projects where id = current_setting('lifecycle.active')::uuid),
  'completed', 'completion changes the stored status');
select is((select visibility::text from public.projects where id = current_setting('lifecycle.active')::uuid),
  'private', 'completion does not expose private projects');
reset role;
select ok((select completed_at >= transaction_timestamp() and completed_at <= clock_timestamp()
  from public.projects where id = current_setting('lifecycle.active')::uuid), 'completion sets the actual timestamp');
select set_config('lifecycle.first_completion', coalesce((select completed_at::text from public.projects
  where id = current_setting('lifecycle.active')::uuid), 'missing'), true);

set local role authenticated;
select lives_ok($$select public.complete_project(current_setting('lifecycle.active')::uuid)$$,
  'completing an already completed project succeeds');
select lives_ok($$select public.complete_project(current_setting('lifecycle.paused')::uuid)$$,
  'a paused project can be completed');
select throws_ok($$select public.complete_project('00000000-0000-4000-8650-000000000103')$$,
  'P0001', 'PROJECT_CANNOT_COMPLETE', 'archived project cannot be completed');
select throws_ok($$select public.complete_project(current_setting('lifecycle.mismatch')::uuid)$$,
  'P0001', 'PROJECT_MANAGEMENT_NOT_ALLOWED', 'owner_id without an owner membership does not authorize completion');
select throws_ok($$select public.complete_project(current_setting('lifecycle.missing')::uuid)$$,
  'P0001', 'PROJECT_MANAGEMENT_NOT_ALLOWED', 'missing project uses the same error as unauthorized access');
set local request.jwt.claim.sub = '00000000-0000-4000-8650-000000000002';
select throws_ok($$select public.complete_project(current_setting('lifecycle.active')::uuid)$$,
  'P0001', 'PROJECT_MANAGEMENT_NOT_ALLOWED', 'ordinary membership does not authorize completion');
set local request.jwt.claim.sub = '00000000-0000-4000-8650-000000000003';
select throws_ok($$select public.complete_project(current_setting('lifecycle.mismatch')::uuid)$$,
  'P0001', 'PROJECT_MANAGEMENT_NOT_ALLOWED', 'owner membership without matching owner_id does not authorize completion');
set local request.jwt.claim.sub = '00000000-0000-4000-8650-000000000004';
select throws_ok($$select public.complete_project('00000000-0000-4000-8650-000000000105')$$,
  'P0001', 'PROJECT_MANAGEMENT_NOT_ALLOWED', 'unverified owner cannot complete');
set local request.jwt.claim.sub = '00000000-0000-4000-8650-000000000005';
select throws_ok($$select public.complete_project('00000000-0000-4000-8650-000000000106')$$,
  'P0001', 'PROJECT_MANAGEMENT_NOT_ALLOWED', 'verified owner without a profile cannot complete');

set local role anon;
select throws_ok($$select public.complete_project(current_setting('lifecycle.active')::uuid)$$,
  '42501', null, 'anonymous role cannot execute completion');
reset role;
select is((select completed_at::text from public.projects where id = current_setting('lifecycle.active')::uuid),
  current_setting('lifecycle.first_completion'), 'completion retry preserves the original timestamp');
select ok((select status = 'completed' and completed_at >= transaction_timestamp()
  from public.projects where id = current_setting('lifecycle.paused')::uuid), 'paused project receives a fresh completion timestamp');
select is((select visibility::text from public.projects where id = current_setting('lifecycle.paused')::uuid),
  'public', 'completion does not hide public projects');

select is((select count(*) from public.project_members where project_id = current_setting('lifecycle.active')::uuid),
  2::bigint, 'completion preserves owner and team memberships');
select is((select count(*) from public.team_tasks where project_id = current_setting('lifecycle.active')::uuid),
  1::bigint, 'completion preserves team tasks');
select is((select count(*) from public.project_report_revisions where id = current_setting('lifecycle.revision')::uuid),
  1::bigint, 'completion preserves report revisions');
set local role anon;
select ok(public.list_report_archive() @> jsonb_build_array(jsonb_build_object('id', current_setting('lifecycle.snapshot'))),
  'completion preserves the visible public archive snapshot');
select throws_ok($$select public.delete_project(current_setting('lifecycle.active')::uuid, true)$$,
  '42501', null, 'anonymous role cannot delete a project');

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8650-000000000002';
select throws_ok($$select public.delete_project(current_setting('lifecycle.active')::uuid, true)$$,
  'P0001', 'PROJECT_MANAGEMENT_NOT_ALLOWED', 'ordinary member cannot delete the project');
select throws_ok($$select public.delete_project(current_setting('lifecycle.missing')::uuid, null)$$,
  'P0001', 'PROJECT_MANAGEMENT_NOT_ALLOWED', 'unknown project uses the authorization error before confirmation');
set local request.jwt.claim.sub = '00000000-0000-4000-8650-000000000003';
select throws_ok($$select public.delete_project(current_setting('lifecycle.mismatch')::uuid, true)$$,
  'P0001', 'PROJECT_MANAGEMENT_NOT_ALLOWED', 'owner membership alone does not authorize deletion');
set local request.jwt.claim.sub = '00000000-0000-4000-8650-000000000004';
select throws_ok($$select public.delete_project('00000000-0000-4000-8650-000000000105', true)$$,
  'P0001', 'PROJECT_MANAGEMENT_NOT_ALLOWED', 'unverified owner cannot delete');
set local request.jwt.claim.sub = '00000000-0000-4000-8650-000000000005';
select throws_ok($$select public.delete_project('00000000-0000-4000-8650-000000000106', true)$$,
  'P0001', 'PROJECT_MANAGEMENT_NOT_ALLOWED', 'verified owner without a profile cannot delete');
set local request.jwt.claim.sub = '00000000-0000-4000-8650-000000000001';
select throws_ok($$select public.delete_project(current_setting('lifecycle.mismatch')::uuid, true)$$,
  'P0001', 'PROJECT_MANAGEMENT_NOT_ALLOWED', 'owner_id alone does not authorize deletion');
select throws_ok($$select public.delete_project(current_setting('lifecycle.active')::uuid, false)$$,
  'P0001', 'PROJECT_DELETE_CONFIRMATION_REQUIRED', 'false confirmation cannot delete');
select throws_ok($$select public.delete_project(current_setting('lifecycle.active')::uuid, null)$$,
  'P0001', 'PROJECT_DELETE_CONFIRMATION_REQUIRED', 'null confirmation cannot delete');
select lives_ok($sql$do $$begin
  if public.delete_project(p_project_id => current_setting('lifecycle.active')::uuid, p_confirm => true)
      is distinct from current_setting('lifecycle.active')::uuid then
    raise exception 'Unexpected deleted project UUID';
  end if;
end$$$sql$, 'confirmed owner deletion returns the deleted project UUID');
select throws_ok($$select public.delete_project(current_setting('lifecycle.active')::uuid, true)$$,
  'P0001', 'PROJECT_MANAGEMENT_NOT_ALLOWED', 'retry after deletion receives the non-disclosing missing-project error');
set local request.jwt.claim.sub = '00000000-0000-4000-8650-000000000003';
select throws_ok($$select public.accept_project_invite(current_setting('lifecycle.invite'))$$,
  'P0001', 'INVITE_UNAVAILABLE', 'deleted invite can no longer be used');
set local role anon;
select ok(not (public.list_report_archive() @> jsonb_build_array(jsonb_build_object('id', current_setting('lifecycle.snapshot')))),
  'deletion removes the snapshot from the public archive');
reset role;
select is((select count(*) from public.projects where id = current_setting('lifecycle.active')::uuid),
  0::bigint, 'project row is physically removed');
select is((select count(*) from public.project_members where project_id = current_setting('lifecycle.active')::uuid),
  0::bigint, 'memberships cascade');
select is((select count(*) from public.project_invitations where project_id = current_setting('lifecycle.active')::uuid),
  0::bigint, 'invites cascade');
select is((select count(*) from public.team_tasks where project_id = current_setting('lifecycle.active')::uuid),
  0::bigint, 'team tasks cascade');
select is((select count(*) from public.team_activity where project_id = current_setting('lifecycle.active')::uuid),
  0::bigint, 'team journal activity cascades');
select is((select count(*) from public.team_feedback_rounds where project_id = current_setting('lifecycle.active')::uuid),
  0::bigint, 'team feedback rounds cascade');
select is((select count(*) from public.team_checkins where project_id = current_setting('lifecycle.active')::uuid),
  0::bigint, 'team check-ins cascade');
select is((select count(*) from public.project_report_revisions where id = current_setting('lifecycle.revision')::uuid),
  0::bigint, 'report revisions cascade');

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8650-000000000001';
select set_config('lifecycle.open_research', public.publish_research_test(
  '00000000-0000-4000-8650-000000000401', current_setting('lifecycle.paused')::uuid,
  'Open research fixture', 'Research lifecycle fixture', 'https://research.example/open', 1, 1)::text, true);
select set_config('lifecycle.closed_research', public.publish_research_test(
  '00000000-0000-4000-8650-000000000402', '00000000-0000-4000-8650-000000000103',
  'Closed research fixture', 'Research lifecycle fixture', 'https://research.example/closed', 1, 1)::text, true);
select public.close_research_test(current_setting('lifecycle.closed_research')::uuid);
select throws_ok($$select public.delete_project(current_setting('lifecycle.paused')::uuid, true)$$,
  'P0001', 'PROJECT_HAS_RESEARCH', 'an open research test blocks deletion');
select throws_ok($$select public.delete_project('00000000-0000-4000-8650-000000000103', true)$$,
  'P0001', 'PROJECT_HAS_RESEARCH', 'a closed research test also blocks deletion');
reset role;
select ok((select closed_at is null from public.research_tests where id = current_setting('lifecycle.open_research')::uuid),
  'a blocked delete does not close the open test');
select ok((select closed_at is not null from public.research_tests where id = current_setting('lifecycle.closed_research')::uuid),
  'the closed research record is retained');
-- Generate the attached project the same way the matching board does.
set local role authenticated;
select set_config('lifecycle.attached', public.create_matching_opportunity(
  'idea', 'Attached recruitment fixture', 'A separate project from matching', '{Testing}', p_gap => 'Looking for testers')::text, true);
set local request.jwt.claim.sub = '00000000-0000-4000-8650-000000000002';
select set_config('lifecycle.accepted_request', public.submit_matching_request(
  current_setting('lifecycle.attached')::uuid, 'Accepted fixture request')::text, true);
set local request.jwt.claim.sub = '00000000-0000-4000-8650-000000000003';
select set_config('lifecycle.pending_request', public.submit_matching_request(
  current_setting('lifecycle.attached')::uuid, 'Pending fixture request')::text, true);
set local request.jwt.claim.sub = '00000000-0000-4000-8650-000000000001';
select set_config('lifecycle.matched_project', public.decide_matching_request(
  current_setting('lifecycle.accepted_request')::uuid, true)::text, true);
reset role;
select set_config('lifecycle.accepted_at', (select decided_at::text from public.matching_requests
  where id = current_setting('lifecycle.accepted_request')::uuid), true);
-- Set up a public reboot source before completion: a paused public project is eligible.
update public.projects set visibility = 'public', status = 'paused' where id = current_setting('lifecycle.matched_project')::uuid;

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8650-000000000003';
-- 00650 precedes the optional attachment migration. Exercise the same
-- source-only relationship through the RPC contract present in each schema.
do $$
declare
  v_id uuid;
  v_source uuid := current_setting('lifecycle.matched_project')::uuid;
  v_request constant uuid := '00000000-0000-4000-8650-000000000105';
begin
  if to_regprocedure('public.begin_matching_reboot(uuid,text)') is not null then
    perform public.begin_matching_reboot(v_request);
    v_id := public.create_matching_opportunity(
      'reboot', 'Independent recruitment', 'Independent third-party recruitment', '{Testing}',
      p_source_project_id => v_source, p_reboot_prior_work => 'Existing map draft',
      p_reboot_changes => 'Validate the revised map', p_reboot_request_id => v_request);
  else
    v_id := public.create_matching_opportunity(
      'reboot', 'Independent recruitment', 'Independent third-party recruitment', '{Testing}',
      p_source_project_id => v_source);
  end if;
  perform set_config('lifecycle.source_only', v_id::text, true);
end;
$$;
set local request.jwt.claim.sub = '00000000-0000-4000-8650-000000000002';
select set_config('lifecycle.independent_request', public.submit_matching_request(
  current_setting('lifecycle.source_only')::uuid, 'Independent applicant request')::text, true);

set local request.jwt.claim.sub = '00000000-0000-4000-8650-000000000001';
select lives_ok($$select public.complete_project(current_setting('lifecycle.matched_project')::uuid)$$,
  'the owner can complete a project created by matching');
select ok((select not is_open from public.list_matching_opportunities(p_mine => true)
  where id = current_setting('lifecycle.attached')::uuid), 'completion closes directly attached recruitment');
select is((select project_id from public.list_matching_opportunities(p_mine => true)
  where id = current_setting('lifecycle.attached')::uuid), current_setting('lifecycle.matched_project')::uuid,
  'completion retains the attached recruitment project link');
select is((select status from public.list_matching_requests(p_received => true)
  where id = current_setting('lifecycle.pending_request')::uuid), 'rejected', 'completion resolves a directly attached pending request');
select throws_ok($$select public.decide_matching_request(current_setting('lifecycle.pending_request')::uuid, true)$$,
  'P0001', 'MATCHING_REQUEST_DECIDED', 'pending approval is no longer actionable after completion');
set local request.jwt.claim.sub = '00000000-0000-4000-8650-000000000006';
select throws_ok($sql$do $$begin
  perform public.submit_matching_request(current_setting('lifecycle.attached')::uuid, 'Late completion fixture request');
  raise exception 'Unexpected application';
end$$$sql$,
  'P0001', 'MATCHING_OPPORTUNITY_CLOSED', 'completed projects take no new applications through attached recruitment');
set local request.jwt.claim.sub = '00000000-0000-4000-8650-000000000003';
select ok((select is_open and source_project_id = current_setting('lifecycle.matched_project')::uuid
  from public.list_matching_opportunities(p_mine => true) where id = current_setting('lifecycle.source_only')::uuid),
  'completion leaves third-party source-only recruitment open and linked');
select is((select status from public.list_matching_requests(p_received => true)
  where id = current_setting('lifecycle.independent_request')::uuid), 'pending',
  'completion leaves third-party applications pending');
reset role;
select ok((select r.status = 'accepted' and r.decided_at::text = current_setting('lifecycle.accepted_at')
  from public.matching_requests r where r.id = current_setting('lifecycle.accepted_request')::uuid),
  'completion preserves the accepted decision and its timestamp');
select set_config('lifecycle.recruitment_transition', (select jsonb_build_array(p.completed_at, o.closed_at, r.decided_at)::text
  from public.projects p join public.matching_opportunities o on o.project_id = p.id
  join public.matching_requests r on r.opportunity_id = o.id
  where r.id = current_setting('lifecycle.pending_request')::uuid), true);
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8650-000000000001';
select lives_ok($$select public.complete_project(current_setting('lifecycle.matched_project')::uuid)$$,
  'completion can be retried for an attached project');
reset role;
select is((select jsonb_build_array(p.completed_at, o.closed_at, r.decided_at)::text
  from public.projects p join public.matching_opportunities o on o.project_id = p.id
  join public.matching_requests r on r.opportunity_id = o.id
  where r.id = current_setting('lifecycle.pending_request')::uuid), current_setting('lifecycle.recruitment_transition'),
  'a completion retry does not rewrite recruitment or project timestamps');

set local role authenticated;
select lives_ok($$select public.delete_project(current_setting('lifecycle.matched_project')::uuid, true)$$,
  'confirmed deletion can remove a project created by matching');
select ok((select not is_open from public.list_matching_opportunities(p_mine => true)
  where id = current_setting('lifecycle.attached')::uuid), 'attached recruitment closes when its project is deleted');
select throws_ok($$select public.decide_matching_request(current_setting('lifecycle.pending_request')::uuid, true)$$,
  'P0001', 'MATCHING_REQUEST_DECIDED', 'a former pending request cannot be approved to create a replacement');
select throws_ok($$select public.decide_matching_request(current_setting('lifecycle.pending_request')::uuid, false)$$,
  'P0001', 'MATCHING_REQUEST_DECIDED', 'a former pending request no longer requires action');
set local request.jwt.claim.sub = '00000000-0000-4000-8650-000000000003';
select ok((select is_open and source_project_id is null from public.list_matching_opportunities(p_mine => true)
  where id = current_setting('lifecycle.source_only')::uuid), 'third-party source-only recruitment stays open with its removed source detached');
select is((select status from public.list_matching_requests(p_received => true)
  where id = current_setting('lifecycle.independent_request')::uuid), 'pending', 'independent pending application is unchanged');
select lives_ok($$select public.decide_matching_request(current_setting('lifecycle.independent_request')::uuid, true)$$,
  'third-party recruitment can still create its independent project');
set local request.jwt.claim.sub = '00000000-0000-4000-8650-000000000006';
select throws_ok($$select public.submit_matching_request(current_setting('lifecycle.attached')::uuid, 'Late fixture request')$$,
  'P0001', 'MATCHING_OPPORTUNITY_CLOSED', 'a closed attached recruitment cannot take new applications');
reset role;
select ok((select project_id is null and project_created_at is not null from public.matching_opportunities
  where id = current_setting('lifecycle.attached')::uuid), 'the detached attached recruitment keeps its creation marker');
select is((select status from public.matching_requests where id = current_setting('lifecycle.accepted_request')::uuid),
  'accepted', 'deletion does not rewrite accepted matching history');
select is((select status from public.matching_requests where id = current_setting('lifecycle.pending_request')::uuid),
  'rejected', 'an attached pending application is terminal');
select is((select count(*) from public.projects where owner_id = '00000000-0000-4000-8650-000000000001'
  and title = 'Attached recruitment fixture'), 0::bigint, 'no replacement attached project was created');

select is((select array_agg(kind order by sequence) from public.research_credit_ledger
    where user_id = '00000000-0000-4000-8650-000000000001'),
  array['starter', 'reserve', 'reserve', 'release'], 'research credit ledger history is unchanged');
select ok((select available = 2 and reserved = 1 from public.research_credit_accounts
  where user_id = '00000000-0000-4000-8650-000000000001'), 'research credit balances are unchanged');

-- Use a separate account to test the rolling window across both creation paths.
insert into public.projects (owner_id, title, description, category, created_at)
values ('00000000-0000-4000-8650-000000000006', 'Aged creation', 'Outside the daily quota window',
  'side_project', now() - interval '1 day');
select ok(coalesce(not (
  has_table_privilege('anon', to_regclass('private.project_creation_history'), 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
  or has_table_privilege('authenticated', to_regclass('private.project_creation_history'), 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
  or has_table_privilege('service_role', to_regclass('private.project_creation_history'), 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
), false), 'project creation history is private to database routines');

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8650-000000000006';
select count(public.create_project('Quota fixture ' || n, 'Daily project quota fixture', 'side_project', 'private'))
  from generate_series(1, 19) n;
select set_config('lifecycle.quota_opportunity', public.create_matching_opportunity(
  'idea', 'Quota recruitment fixture', 'Creates the twentieth project', '{Testing}', p_gap => 'Looking for testers')::text, true);
select set_config('lifecycle.next_opportunity', public.create_matching_opportunity(
  'idea', 'Next recruitment fixture', 'Shares the daily creation limit', '{Testing}', p_gap => 'Looking for testers')::text, true);
set local request.jwt.claim.sub = '00000000-0000-4000-8650-000000000002';
select set_config('lifecycle.quota_request', public.submit_matching_request(
  current_setting('lifecycle.quota_opportunity')::uuid, 'Apply to the quota fixture')::text, true);
select set_config('lifecycle.next_request', public.submit_matching_request(
  current_setting('lifecycle.next_opportunity')::uuid, 'Apply to the next quota fixture')::text, true);
set local request.jwt.claim.sub = '00000000-0000-4000-8650-000000000003';
select set_config('lifecycle.quota_pending_request', public.submit_matching_request(
  current_setting('lifecycle.quota_opportunity')::uuid, 'Another application to the quota fixture')::text, true);
set local request.jwt.claim.sub = '00000000-0000-4000-8650-000000000006';
select ok(set_config('lifecycle.quota_project', public.decide_matching_request(
  current_setting('lifecycle.quota_request')::uuid, true)::text, true) is not null,
  'the twentieth creation succeeds via matching and a creation exactly one day old does not count');
select throws_ok($$select public.create_project('Next quota fixture', 'Daily project quota fixture', 'side_project', 'private')$$,
  'P0001', 'PROJECT_RATE_LIMIT', 'matching-generated projects count toward the manual daily limit');
select lives_ok($$select public.delete_project(current_setting('lifecycle.quota_project')::uuid, true)$$,
  'the owner can permanently delete the twentieth project');
select ok((select not o.is_open and r.status = 'rejected'
  from public.list_matching_opportunities(p_mine => true) o cross join public.list_matching_requests(p_received => true) r
  where o.id = current_setting('lifecycle.quota_opportunity')::uuid and r.id = current_setting('lifecycle.quota_pending_request')::uuid),
  'deletion without prior completion closes attached recruitment and resolves its pending requests');
select throws_ok($sql$do $$begin
  perform public.create_project('Next quota fixture', 'Daily project quota fixture', 'side_project', 'private');
  raise exception 'Unexpected project creation'; -- Roll back the attempted creation even on regression.
end$$$sql$,
  'P0001', 'PROJECT_RATE_LIMIT', 'permanent deletion does not restore a manual creation slot');
select throws_ok($sql$do $$begin
  perform public.decide_matching_request(current_setting('lifecycle.next_request')::uuid, true);
  raise exception 'Unexpected project creation';
end$$$sql$,
  'P0001', 'PROJECT_RATE_LIMIT', 'permanent deletion does not restore a matching creation slot');
reset role;
select lives_ok($sql$do $$begin
  if exists (select 1 from private.project_creation_history
    where account_id = '00000000-0000-4000-8650-000000000006' and created_at <= now() - interval '1 day') then
    raise exception 'Expired creation history was not pruned';
  end if;
end$$$sql$, 'successful create prunes expired history for the same account');

select * from finish();
rollback;
