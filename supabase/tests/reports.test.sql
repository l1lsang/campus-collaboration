begin;
set local search_path = public, extensions;
select plan(36);

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-4000-8100-000000000001','owner@reports-test.example',now()),
  ('00000000-0000-4000-8100-000000000002','member@reports-test.example',now()),
  ('00000000-0000-4000-8100-000000000003','outsider@reports-test.example',now()),
  ('00000000-0000-4000-8100-000000000004','unverified@reports-test.example',now());
insert into public.universities (id,name,short_name) values
  ('00000000-0000-4000-8100-000000000042','보고서 테스트대학교','보고서 테스트대');
insert into public.university_email_domains (university_id,email_domain) values
  ('00000000-0000-4000-8100-000000000042','reports-test.example');
insert into public.profiles (id,nickname,university_id,major,bio,skills,interests,preferred_category)
select id, case when email like 'member%' then '내부팀원' else '보고서테스터' end,
  '00000000-0000-4000-8100-000000000042', '테스트 전공', '자기소개 문장', '{React}', '{협업}', 'side_project'
from auth.users where id::text like '00000000-0000-4000-8100-00000000000%';
insert into auth.identities (provider_id,user_id,provider,identity_data)
select id::text, id, 'google', jsonb_build_object('email',email,'email_verified',true,
  'custom_claims',jsonb_build_object('hd','reports-test.example'))
from auth.users where id::text like '00000000-0000-4000-8100-00000000000%' and email not like 'unverified%';
insert into public.projects (id,owner_id,title,description,category,visibility,status) values
  ('00000000-0000-4000-8100-000000000101','00000000-0000-4000-8100-000000000001','내부 프로젝트','비공개 목표의 근거가 되는 프로젝트 소개','side_project','private','completed'),
  ('00000000-0000-4000-8100-000000000102','00000000-0000-4000-8100-000000000003','다른 프로젝트','현재 팀원이 볼 수 없는 별도 프로젝트','side_project','public','completed');
insert into public.project_members (id,project_id,user_id,membership_role) values
  ('00000000-0000-4000-8100-000000000201','00000000-0000-4000-8100-000000000101','00000000-0000-4000-8100-000000000001','owner'),
  ('00000000-0000-4000-8100-000000000202','00000000-0000-4000-8100-000000000101','00000000-0000-4000-8100-000000000002','member'),
  ('00000000-0000-4000-8100-000000000203','00000000-0000-4000-8100-000000000101','00000000-0000-4000-8100-000000000004','member');
insert into public.team_activity (id,project_id,actor_id,event_type,details,created_at) values
  ('00000000-0000-4000-8100-000000000301','00000000-0000-4000-8100-000000000101','00000000-0000-4000-8100-000000000002','task_completed','{"text":"PRIVATE_ACTIVITY_DETAILS"}',now()),
  ('00000000-0000-4000-8100-000000000302','00000000-0000-4000-8100-000000000101','00000000-0000-4000-8100-000000000002','feedback_submitted','{"text":"ANONYMOUS_FEEDBACK"}',now()),
  ('00000000-0000-4000-8100-000000000303','00000000-0000-4000-8100-000000000101','00000000-0000-4000-8100-000000000002','checkin_submitted','{"text":"ANONYMOUS_CHECKIN"}',now()),
  ('00000000-0000-4000-8100-000000000304','00000000-0000-4000-8100-000000000102','00000000-0000-4000-8100-000000000003','task_completed','{}',now());

set local role authenticated;
set local request.jwt.claims = '{"amr":[{"method":"oauth"}]}';
set local request.jwt.claim.sub = '00000000-0000-4000-8100-000000000002';
select set_config('reports.preview',public.preview_project_report('00000000-0000-4000-8100-000000000101','activity','{"explanation":"직접 확인한 지연 사유","results":"팀에서 확인한 결과"}')::text,true);
select ok(current_setting('reports.preview') like '%비공개 목표의 근거%' and current_setting('reports.preview') like '%내부팀원%','프로젝트 및 팀 역할을 초안에 반영한다');
select ok(current_setting('reports.preview') like '%activity:00000000-0000-4000-8100-000000000301%' and current_setting('reports.preview') not like '%00000000-0000-4000-8100-000000000304%','이 프로젝트의 허용된 활동만 출처로 사용한다');
select ok(current_setting('reports.preview') not like '%PRIVATE_ACTIVITY_DETAILS%','일반 활동도 자유 입력 세부 정보는 제공하지 않는다');
select ok(current_setting('reports.preview') not like '%ANONYMOUS_%' and current_setting('reports.preview') not like '%00000000-0000-4000-8100-000000000302%' and current_setting('reports.preview') not like '%00000000-0000-4000-8100-000000000303%','익명 피드백 및 체크인 입력, 식별자, 활동을 제외한다');
select ok(current_setting('reports.preview') like '%input:explanation%' and current_setting('reports.preview') like '%팀에서 확인한 결과%','설명과 결과를 팀원 입력 출처로 구분한다');
select ok(public.preview_project_report('00000000-0000-4000-8100-000000000101','failure','{}')::text like '%실패가 있었다고 추정하지%','실패 근거가 없을 때 실패를 추정하지 않는다');
select throws_ok($$select public.preview_project_report('00000000-0000-4000-8100-000000000101','activity','{"activity":"위조 근거"}')$$,'P0001','REPORT_INVALID_INPUT','입력 스키마에 없는 근거는 거부한다');
set local request.jwt.claim.sub = '00000000-0000-4000-8100-000000000003';
select throws_ok($$select public.preview_project_report('00000000-0000-4000-8100-000000000101','activity','{}')$$,'P0001','PROJECT_MEMBER_REQUIRED','비팀원은 초안을 얻을 수 없다');
set local request.jwt.claim.sub = '00000000-0000-4000-8100-000000000004';
select throws_ok($$select public.preview_project_report('00000000-0000-4000-8100-000000000101','activity','{}')$$,'P0001','VERIFIED_UNIVERSITY_REQUIRED','미인증 팀원은 초안을 얻을 수 없다');
set local request.jwt.claim.sub = '00000000-0000-4000-8100-000000000002';
select set_config('reports.project','00000000-0000-4000-8100-000000000101',true);
select ok(public.preview_project_report(current_setting('reports.project')::uuid,'contribution','{}')::text like '%내부팀원 · 팀원 · 활동 1건%','기여 항목은 해당 팀원의 허용 활동만 집계한다');
select ok(public.preview_project_report(current_setting('reports.project')::uuid,'failure','{"failure":"확인한 미달 사항"}')->'sections'
  @> '[{"key":"failure","items":[{"text":"확인한 미달 사항","sourceIds":["input:failure"]}]}]','직접 확인한 실패 사실을 팀원 입력 근거로 제시한다');
set local request.jwt.claim.sub = '00000000-0000-4000-8100-000000000001';
select public.team_assign_role(current_setting('reports.project')::uuid,'00000000-0000-4000-8100-000000000202','검증 담당');
select set_config('reports.done',public.team_create_task(current_setting('reports.project')::uuid,'완료한 실제 작업','보고서에 노출하지 않을 작업 상세',2,current_date,array['00000000-0000-4000-8100-000000000202']::uuid[])::text,true);
select public.team_create_task(current_setting('reports.project')::uuid,'인계할 실제 작업','인계에 불필요한 작업 상세',2,current_date,array['00000000-0000-4000-8100-000000000202']::uuid[]);
select public.team_set_task_status(current_setting('reports.done')::uuid,'done');
set local request.jwt.claim.sub = '00000000-0000-4000-8100-000000000002';
select set_config('reports.from_team',public.preview_project_report(current_setting('reports.project')::uuid,'handoff','{}')::text,true);
select ok(current_setting('reports.from_team') like '%내부팀원%검증 담당%','팀에 배정된 실제 업무 역할을 제시한다');
select ok(current_setting('reports.from_team') like '%완료한 실제 작업%' and current_setting('reports.from_team') like '%task:' || current_setting('reports.done') || '%','완료 작업을 실제 근거 ID와 함께 결과에 포함한다');
select ok(current_setting('reports.from_team') like '%인계할 실제 작업%' and current_setting('reports.from_team') not like '%작업 상세%','미완료 작업에 근거한 인수인계와 필요한 정보만 제공한다');
select is(jsonb_array_length(public.list_report_archive()),0,'보고서는 기본적으로 공개되지 않는다');
set local request.jwt.claim.sub = '00000000-0000-4000-8100-000000000001';
select set_config('reports.v1',public.save_project_report(current_setting('reports.project')::uuid,'handoff',0,
  '{"goals":"  내부 목표  ","roles":"내부 운영 담당","results":"팀에서 확인한 결과","failure":"내부 실패","handoff":"내부 인수인계"}')::text,true);
select is((current_setting('reports.v1')::jsonb->>'number')::int,1,'소유자는 첫 판을 저장할 수 있다');
select is(current_setting('reports.v1')::jsonb->'inputs'->>'goals','내부 목표','저장된 입력은 양끝 공백을 제외한다');
select ok(current_setting('reports.v1')::jsonb->'draft'->'sections' @> '[{"key":"handoff","items":[{"text":"내부 인수인계","sourceIds":["input:handoff"]}]}]','인수인계 초안에는 입력 근거가 있다');
select throws_ok($$select public.save_project_report(current_setting('reports.project')::uuid,'handoff',0,'{}')$$,'P0001','REPORT_REVISION_CONFLICT','최신판보다 오래된 편집은 덮어쓸 수 없다');
select set_config('reports.v2',public.save_project_report(current_setting('reports.project')::uuid,'handoff',1,'{"results":"새 결과"}')::text,true);
select is((current_setting('reports.v2')::jsonb->>'number')::int,2,'다음 판은 새 번호로 추가된다');
set local request.jwt.claim.sub = '00000000-0000-4000-8100-000000000002';
select is(public.get_project_report_revision(current_setting('reports.project')::uuid,'handoff',(current_setting('reports.v1')::jsonb->>'id')::uuid),current_setting('reports.v1')::jsonb,'이전 판의 초안과 입력은 그대로 남는다');
select is(jsonb_array_length(public.list_project_report_revisions(current_setting('reports.project')::uuid,'handoff',2)),1,'이력은 이전 번호를 기준으로 조회할 수 있다');
select throws_ok($$select public.get_project_report_revision(current_setting('reports.project')::uuid,'activity',(current_setting('reports.v1')::jsonb->>'id')::uuid)$$,'P0001','REPORT_REVISION_NOT_FOUND','다른 보고서 유형의 판을 열 수 없다');
select throws_ok($$select draft from public.project_report_revisions$$,'42501',null,'팀원도 비공개 저장소 테이블을 직접 조회할 수 없다');
select throws_ok($$select public.publish_project_report(current_setting('reports.project')::uuid,'handoff',(current_setting('reports.v1')::jsonb->>'id')::uuid,true,'{"title":"공개 제목","summary":"공개 요약"}')$$,'P0001','PROJECT_OWNER_REQUIRED','일반 팀원은 공개할 수 없다');
set local request.jwt.claim.sub = '00000000-0000-4000-8100-000000000001';
select throws_ok($$select public.publish_project_report(current_setting('reports.project')::uuid,'handoff',(current_setting('reports.v1')::jsonb->>'id')::uuid,null,'{"title":"공개 제목","summary":"공개 요약"}')$$,'P0001','REPORT_PUBLIC_OPT_IN_REQUIRED','소유자도 명시적 동의 없이는 공개할 수 없다');
select throws_ok($$select public.publish_project_report(current_setting('reports.project')::uuid,'handoff',(current_setting('reports.v1')::jsonb->>'id')::uuid,true,'{"title":"공개 제목","summary":"공개 요약","sourceIds":"원본 출처"}')$$,'P0001','REPORT_INVALID_INPUT','공개용 허용 필드 밖의 원본 근거는 받지 않는다');
select throws_ok($$select public.publish_project_report(current_setting('reports.project')::uuid,'activity',(current_setting('reports.v1')::jsonb->>'id')::uuid,true,'{"title":"공개 제목","summary":"공개 요약"}')$$,'P0001','REPORT_REVISION_NOT_FOUND','소유자도 다른 유형의 판을 공개할 수 없다');
select set_config('reports.archive',public.publish_project_report(current_setting('reports.project')::uuid,'handoff',(current_setting('reports.v1')::jsonb->>'id')::uuid,true,'{"title":"공개 제목","summary":"공개 요약","results":"공개용 성과"}')::text,true);
select is(public.get_project_report_workspace(current_setting('reports.project')::uuid,'handoff')->'publication'->>'title','공개 제목','소유자는 현재 공개본을 확인할 수 있다');
select public.save_project_report(current_setting('reports.project')::uuid,'handoff',2,'{"results":"공개 이후 편집된 비공개 결과"}') is not null;
set local request.jwt.claim.sub = '00000000-0000-4000-8100-000000000002';
select throws_ok($$select public.unpublish_project_report(current_setting('reports.project')::uuid,'handoff')$$,'P0001','PROJECT_OWNER_REQUIRED','다른 팀원은 공개를 취소할 수 없다');
set local role anon;
select is(jsonb_array_length(public.list_report_archive()),1,'비회원도 명시적으로 공개된 스냅샷을 읽을 수 있다');
select is((public.list_report_archive()->0) - array['id','publishedAt','kind'],'{"title":"공개 제목","summary":"공개 요약","results":"공개용 성과"}'::jsonb,'아카이브에는 별도 입력으로 승인한 항목만 남는다');
select is(jsonb_array_length(public.list_report_archive((public.list_report_archive()->0->>'publishedAt')::timestamptz,(public.list_report_archive()->0->>'id')::uuid)),0,'페이지 커서는 이미 읽은 스냅샷을 제외한다');
select throws_ok($$select public.get_project_report_workspace(current_setting('reports.project')::uuid,'handoff')$$,'42501',null,'비회원은 보고서 작업공간 RPC를 호출할 수 없다');
select throws_ok($$select project_id, revision_id from public.report_archive_snapshots$$,'42501',null,'비회원은 공개 스냅샷의 내부 식별자를 직접 읽을 수 없다');
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8100-000000000001';
select public.unpublish_project_report(current_setting('reports.project')::uuid,'handoff');
set local role anon;
select is(jsonb_array_length(public.list_report_archive()),0,'소유자가 공개를 거두면 아카이브에서 사라진다');
select * from finish();
rollback;
