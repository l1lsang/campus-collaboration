begin;
set local search_path = public, extensions;
select plan(30);

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-4000-8900-000000000001', 'owner@report-editor.example', now()),
  ('00000000-0000-4000-8900-000000000002', 'member@report-editor.example', now()),
  ('00000000-0000-4000-8900-000000000003', 'outsider@report-editor.example', now());
insert into public.universities (id, name, short_name) values
  ('00000000-0000-4000-8900-000000000042', '초안 편집 테스트대학교', '초안 편집 테스트대');
insert into public.university_email_domains (university_id, email_domain) values
  ('00000000-0000-4000-8900-000000000042', 'report-editor.example');
insert into public.profiles (id, nickname, university_id, major, bio, skills, interests, preferred_category)
select id, '테스트 팀원', '00000000-0000-4000-8900-000000000042',
  '테스트 전공', '자기소개 문장', '{React}', '{협업}', 'side_project'
from auth.users where id::text like '00000000-0000-4000-8900-00000000000%';
insert into auth.identities (provider_id, user_id, provider, identity_data)
select id::text, id, 'google', jsonb_build_object('email', email, 'email_verified', true,
  'custom_claims', jsonb_build_object('hd', 'report-editor.example'))
from auth.users where id::text like '00000000-0000-4000-8900-00000000000%';
insert into public.projects (id, owner_id, title, description, category, visibility, status) values
  ('00000000-0000-4000-8900-000000000101', '00000000-0000-4000-8900-000000000001',
    '내부 프로젝트', '공개에 포함되지 않는 프로젝트 설명', 'side_project', 'private', 'completed');
insert into public.project_members (project_id, user_id, membership_role) values
  ('00000000-0000-4000-8900-000000000101', '00000000-0000-4000-8900-000000000001', 'owner'),
  ('00000000-0000-4000-8900-000000000101', '00000000-0000-4000-8900-000000000002', 'member');
insert into public.team_activity (project_id, actor_id, event_type, details) values
  ('00000000-0000-4000-8900-000000000101', '00000000-0000-4000-8900-000000000002',
    'feedback_submitted', '{"text":"ANONYMOUS_FEEDBACK_PRIVATE"}');

set local role authenticated;
set local request.jwt.claims = '{"amr":[{"method":"oauth"}]}';
set local request.jwt.claim.sub = '00000000-0000-4000-8900-000000000001';
set local report_editor.project = '00000000-0000-4000-8900-000000000101';
set local report_editor.layout = '{"title":"내부 편집 제목","source":"template","sections":[{"heading":"다음 단계","body":"둘째 줄까지\n그대로"},{"heading":"결과","body":"<b>태그가 아닌 일반 텍스트</b>"}]}';

select set_config('report_editor.legacy', public.save_project_report(current_setting('report_editor.project')::uuid,
  'activity', 0, '{"explanation":"삭제할 내부 설명"}')::text, true);
select ok(current_setting('report_editor.legacy')::jsonb->'draft'->'sections' @>
  '[{"key":"explanation","items":[{"text":"삭제할 내부 설명"}]}]', '기존 템플릿 판에는 원래 근거가 남는다');
select lives_ok($$select set_config('report_editor.saved', public.save_project_report_layout(current_setting('report_editor.project')::uuid,
  'activity', 1, current_setting('report_editor.layout')::jsonb)::text, true)$$, '소유자는 제목과 순서를 바꾸고 근거를 빼서 새 판을 저장한다');
-- Missing first-save RPC still produces a complete, useful RED TAP run.
select is((current_setting('report_editor.saved', true)::jsonb->>'number')::integer, 2, '새 판 번호가 생성된다');
select is(current_setting('report_editor.saved', true)::jsonb->'draft',
  current_setting('report_editor.layout')::jsonb || '{"method":"editable"}', '순서와 평문이 저장되고 삭제한 항목이 되살아나지 않는다');
select is(current_setting('report_editor.saved', true)::jsonb->'inputs', '{}'::jsonb, '삭제한 템플릿 입력은 새 판에 복사하지 않는다');
select is(public.get_project_report_revision(current_setting('report_editor.project')::uuid, 'activity',
  (current_setting('report_editor.legacy')::jsonb->>'id')::uuid), current_setting('report_editor.legacy')::jsonb, '이전 생성 판을 그대로 읽을 수 있다');
select throws_ok($$select public.save_project_report_layout(current_setting('report_editor.project')::uuid,
  'activity', 1, current_setting('report_editor.layout')::jsonb)$$, 'P0001', 'REPORT_REVISION_CONFLICT', '오래된 기준판으로는 저장할 수 없다');
select throws_ok($$select public.save_project_report_layout(current_setting('report_editor.project')::uuid,
  'activity', 2, '{"source":"blank","title":" ","sections":[]}')$$, 'P0001', 'REPORT_INVALID_INPUT', '공백 제목을 거부한다');
select throws_ok($$select public.save_project_report_layout(current_setting('report_editor.project')::uuid,
  'activity', 2, '{"source":"blank","title":"제목","sections":[{"heading":"성과","body":"확인","sourceIds":["fake"]}]}')$$,
  'P0001', 'REPORT_INVALID_INPUT', '편집 문안에 숨은 메타데이터를 허용하지 않는다');
select throws_ok($$select public.save_project_report_layout(current_setting('report_editor.project')::uuid,
  'activity', 2, '{"source":"blank","title":"제목","sections":[{"heading":"성과","body":null}]}')$$,
  'P0001', 'REPORT_INVALID_INPUT', '본문은 필드가 포함된 평문만 허용한다');
select throws_ok($$select public.save_project_report_layout(current_setting('report_editor.project')::uuid,
  'activity', 2, jsonb_build_object('source', 'blank', 'title', '제목', 'sections', jsonb_build_array(jsonb_build_object('heading', '성과', 'body', repeat('x', 24001)))))$$,
  'P0001', 'REPORT_INVALID_INPUT', '본문 길이 한도를 적용한다');
select lives_ok($$select public.save_project_report_layout(current_setting('report_editor.project')::uuid,
  'handoff', 0, '{"source":"blank","title":"제목만 있는 초안","sections":[]}')$$, '섹션을 모두 삭제하고 저장할 수 있다');
select lives_ok($$select public.save_project_report(current_setting('report_editor.project')::uuid,
  'contribution', 0, '{}')$$, '소유자는 아직 편집기로 전환하지 않은 유형에 템플릿 판을 저장할 수 있다');
select throws_ok($$select public.save_project_report(current_setting('report_editor.project')::uuid, 'activity', 2, '{}')$$,
  'P0001', 'REPORT_LAYOUT_LOCKED', '소유자도 기존 템플릿 저장으로 편집 판을 대체할 수 없다');

set local request.jwt.claim.sub = '00000000-0000-4000-8900-000000000002';
select is(public.get_project_report_workspace(current_setting('report_editor.project')::uuid, 'activity')->'latestRevision'->'draft',
  current_setting('report_editor.layout')::jsonb || '{"method":"editable"}', '일반 팀원은 저장된 편집 미리보기를 읽는다');
select throws_ok($$select public.save_project_report_layout(current_setting('report_editor.project')::uuid,
  'activity', 2, current_setting('report_editor.layout')::jsonb)$$, 'P0001', 'PROJECT_OWNER_REQUIRED', '일반 팀원은 편집 저장 RPC를 사용할 수 없다');
select throws_ok($$select public.save_project_report_layout(current_setting('report_editor.project')::uuid,
  'failure', 0, current_setting('report_editor.layout')::jsonb)$$, 'P0001', 'PROJECT_OWNER_REQUIRED', '일반 팀원은 편집 초안의 첫 판도 저장할 수 없다');
select throws_ok($$select public.save_project_report(current_setting('report_editor.project')::uuid, 'contribution', 1, '{}')$$,
  'P0001', 'PROJECT_OWNER_REQUIRED', '일반 팀원은 기존 템플릿 판에 새 판을 추가할 수 없다');
select throws_ok($$select public.save_project_report(current_setting('report_editor.project')::uuid, 'failure', 0, '{}')$$,
  'P0001', 'PROJECT_OWNER_REQUIRED', '일반 팀원은 기존 템플릿 저장 RPC로 첫 판을 만들 수 없다');
select is(public.get_project_report_revision(current_setting('report_editor.project')::uuid, 'activity',
  (current_setting('report_editor.legacy')::jsonb->>'id')::uuid), current_setting('report_editor.legacy')::jsonb, '일반 팀원은 이전 템플릿 판을 그대로 읽는다');
select throws_ok($$update public.project_report_revisions set draft = '{}' where false$$,
  '42501', null, '일반 팀원은 판 테이블을 직접 변경할 수도 없다');
set local request.jwt.claim.sub = '00000000-0000-4000-8900-000000000003';
select throws_ok($$select public.get_project_report_workspace(current_setting('report_editor.project')::uuid, 'activity')$$,
  'P0001', 'PROJECT_MEMBER_REQUIRED', '외부인은 저장된 편집 초안을 읽을 수 없다');
set local request.jwt.claim.sub = '00000000-0000-4000-8900-000000000001';
select set_config('report_editor.published', public.publish_project_report(current_setting('report_editor.project')::uuid,
  'activity', (current_setting('report_editor.saved')::jsonb->>'id')::uuid, true,
  '{"title":"별도 공개 제목","summary":"별도로 승인한 공개 요약"}')::text, true);
select set_config('report_editor.boundary', jsonb_build_object('title', '제목', 'source', 'blank', 'sections', (
  select jsonb_agg(jsonb_build_object('heading', case when i < 4 then 'A' else 'B' end,
    'body', case when i < 4 then repeat('한', 24000) else repeat(E'\n', 22986) end) order by i)
  from generate_series(1, 4) i))::text, true) is not null;
select set_config('report_editor.oversize', jsonb_set(current_setting('report_editor.boundary')::jsonb,
  '{sections,3,body}', to_jsonb(repeat(E'\n', 22986) || 'x'))::text, true) is not null;
select is(octet_length(current_setting('report_editor.boundary')), 262144, '한글과 이스케이프가 포함된 JSONB의 한도 경계를 검증한다');
select is(octet_length(current_setting('report_editor.oversize')), 262145, '각 섹션이 유효해도 합계는 한도를 1바이트 초과할 수 있다');
select throws_ok($$select public.save_project_report_layout(current_setting('report_editor.project')::uuid,
  'activity', 2, current_setting('report_editor.oversize')::jsonb)$$, 'P0001', 'REPORT_LAYOUT_TOO_LARGE', '합계 바이트 한도를 넘으면 편집 판을 저장할 수 없다');
select lives_ok($$select public.save_project_report_layout(current_setting('report_editor.project')::uuid,
  'activity', 2, current_setting('report_editor.boundary')::jsonb)$$, '정확히 한도에 맞는 편집 판은 같은 기준 번호로 저장할 수 있다');
select is((public.get_project_report_workspace(current_setting('report_editor.project')::uuid, 'activity')->'latestRevision'->>'number')::integer,
  3, '한도를 초과한 요청은 판 번호를 소비하지 않는다');
select is(public.get_project_report_workspace(current_setting('report_editor.project')::uuid, 'activity')->'publication',
  current_setting('report_editor.published')::jsonb, '새 편집 판을 저장해도 별도 공개본은 달라지지 않는다');
set local role anon;
select throws_ok($$select public.save_project_report_layout(current_setting('report_editor.project')::uuid,
  'activity', 2, current_setting('report_editor.layout')::jsonb)$$, '42501', null, '비로그인 사용자는 저장 RPC를 호출할 수 없다');
select ok(not exists (select 1 from jsonb_array_elements(public.list_report_archive()) as snapshot
  where snapshot->>'title' = '내부 편집 제목' or snapshot::text like '%ANONYMOUS_FEEDBACK_PRIVATE%'), '편집 판이나 익명 피드백은 아카이브에 자동 공개되지 않는다');
select * from finish();
rollback;
