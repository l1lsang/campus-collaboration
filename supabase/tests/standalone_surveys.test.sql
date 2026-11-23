begin;
set local search_path = public, extensions;
select plan(86);

insert into public.universities (id,name,short_name) values
  ('34000000-0000-4000-8000-000000000042','설문 테스트대학교','설문대');
insert into public.university_email_domains (university_id,email_domain) values
  ('34000000-0000-4000-8000-000000000042','survey-test.example');
insert into auth.users (id,email,email_confirmed_at,raw_app_meta_data) values
  ('34000000-0000-4000-8000-000000000001','owner@survey-test.example',now(),'{"provider":"google","providers":["google"]}'),
  ('34000000-0000-4000-8000-000000000002','tester@survey-test.example',now(),'{"provider":"google","providers":["google"]}'),
  ('34000000-0000-4000-8000-000000000003','other@survey-test.example',now(),'{"provider":"google","providers":["google"]}'),
  ('34000000-0000-4000-8000-000000000004','visitor@survey-test.example',now(),'{"provider":"email","providers":["email"]}');
insert into auth.identities (provider_id,user_id,identity_data,provider) select
  'survey-' || id, id, jsonb_build_object('sub','survey-' || id,'email',email,'email_verified',true,
    'custom_claims',jsonb_build_object('hd','survey-test.example')), 'google'
from auth.users where id::text like '34000000-0000-4000-8000-00000000000%' and raw_app_meta_data->>'provider' = 'google';
insert into public.profiles (id,nickname,university_id,major,bio,skills,interests,preferred_category)
select id, '설문 테스터', '34000000-0000-4000-8000-000000000042', '전공', '소개', '{React}', '{협업}', 'research'
from auth.users where id::text like '34000000-0000-4000-8000-00000000000%';

set local role authenticated;
set local request.jwt.claims = '{"amr":[{"method":"oauth"}]}';
set local request.jwt.claim.sub = '34000000-0000-4000-8000-000000000001';
select lives_ok($$select set_config('test.survey',public.publish_research_survey(
  '34100000-0000-4000-8000-000000000001',null,'학교 생활 설문','외부 폼에서 설문에 응답해 주세요.',
  'https://xn--vv4b11d.xn--3e0b707e/form',2,1)::text,true)$$,'프로젝트 없이 국제화 도메인의 설문을 등록한다');
select is((public.my_research_credits()->>'reserved')::bigint,2::bigint,'독립 설문에도 정원만큼 보상 크레딧을 예약한다');
select is(public.publish_research_survey('34100000-0000-4000-8000-000000000001',null,'학교 생활 설문',
  '외부 폼에서 설문에 응답해 주세요.','https://xn--vv4b11d.xn--3e0b707e/form',2,1),current_setting('test.survey')::uuid,'독립 설문 게시 재시도는 안전하다');
select throws_ok($$select public.publish_research_survey('34100000-0000-4000-8000-000000000002',null,'학교 생활 설문',
  '외부 폼에서 설문에 응답해 주세요.','http://forms.gle/sample123',1,1)$$,'P0001','RESEARCH_INVALID_DETAILS','HTTP 설문 링크를 거절한다');
select throws_ok($$select public.publish_research_survey('34100000-0000-4000-8000-000000000002',null,'학교 생활 설문',
  '외부 폼에서 설문에 응답해 주세요.','https://forms.gle@example.org/test',1,1)$$,'P0001','RESEARCH_INVALID_DETAILS','인증 정보가 들어간 주소를 거절한다');
select throws_ok($$select public.publish_research_survey('34100000-0000-4000-8000-000000000099',null,'학교 생활 설문',
  '외부 폼에서 설문에 응답해 주세요.','https://forms.gle:99999/sample123',1,1)$$,'P0001','RESEARCH_INVALID_DETAILS','유효하지 않은 포트를 거절한다');
select throws_ok(format($$select public.publish_research_survey('34100000-0000-4000-8000-000000000099',null,
  '학교 생활 설문','외부 폼에서 설문에 응답해 주세요.',%L,20,10)$$, url), 'P0001',
  case when valid then 'RESEARCH_INSUFFICIENT_CREDITS' else 'RESEARCH_INVALID_DETAILS' end, label)
from (values
  ('HTTPS://docs.google.com:443/forms/d/e/sample/viewform?x=1#entry',true,'Google Forms HTTPS 주소를 통과시킨다'),
  ('https://form.naver.com/response/%ED%95%9C',true,'인코딩된 네이버 폼 주소를 통과시킨다'),
  ('https://3form.example:65535/한글',true,'숫자로 시작하는 DNS 라벨과 유효한 포트를 통과시킨다'),
  ('https://xn--vv4b11d.xn--3e0b707e/form',true,'한국어 도메인의 HTTPS A-label을 통과시킨다'),
  ('https://xn--bcher-kva.example/form',true,'국제화 도메인의 기존 HTTPS A-label을 통과시킨다'),
  ('https://127.0.0.1/form',false,'IPv4 리터럴을 거절한다'),
  ('https://127.1/form',false,'축약 IPv4를 거절한다'),
  ('https://0177.0.0.1/form',false,'8진수 IPv4를 거절한다'),
  ('https://0x7f.0x1/form',false,'16진수 IPv4를 거절한다'),
  ('https://2130706433/form',false,'단일 숫자 IPv4를 거절한다'),
  ('https://forms.123/form',false,'해석이 모호한 숫자 최상위 라벨을 거절한다'),
  ('https://[::1]/form',false,'IPv6 리터럴을 거절한다'),
  ('https://sub.localhost/form',false,'localhost 하위 도메인을 거절한다'),
  ('https://-form.example/form',false,'하이픈으로 시작하는 라벨을 거절한다'),
  ('https://form-.example/form',false,'하이픈으로 끝나는 라벨을 거절한다'),
  ('https://forms.gle./form',false,'후행 점이 있는 주소를 거절한다'),
  ('https://%66orms.gle/form',false,'호스트를 인코딩한 주소를 거절한다'),
  ('https://xn--a.example/form',false,'페이로드가 너무 짧은 A-label을 거절한다'),
  ('https://１２７.０.０.１/form',false,'IP로 정규화될 수 있는 유니코드 호스트를 거절한다'),
  ('https://sub.ｌｏｃａｌｈｏｓｔ/form',false,'localhost로 정규화될 수 있는 유니코드 호스트를 거절한다'),
  (U&'https://forms.gle/\FEFFform',false,'경로의 보이지 않는 공백을 거절한다')
) cases(url, valid, label);
select throws_ok($$select public.publish_research_test('34100000-0000-4000-8000-000000000002',null,'학교 생활 설문',
  '외부 폼에서 설문에 응답해 주세요.','https://forms.gle/sample123',1,1)$$,'P0001','RESEARCH_PROJECT_OWNER_REQUIRED','기존 프로젝트 테스트에는 프로젝트가 계속 필요하다');
select set_config('test.survey_project',public.create_project('비공개 실험 프로젝트','비공개 프로젝트 설명입니다.','research','private')::text,true);
select lives_ok($$select set_config('test.linked_survey',public.publish_research_survey(
  '34100000-0000-4000-8000-000000000002',current_setting('test.survey_project')::uuid,'학습 습관 설문','외부 폼에서 설문에 응답해 주세요.',
  'https://naver.me/sample123',1,1)::text,true)$$,'소유한 프로젝트에 네이버 폼 설문을 연결할 수 있다');
select throws_ok($$select public.publish_research_test('34100000-0000-4000-8000-000000000002',current_setting('test.survey_project')::uuid,
  '학습 습관 설문','외부 폼에서 설문에 응답해 주세요.','https://naver.me/sample123',1,1)$$,'P0001','RESEARCH_REQUEST_CONFLICT','동일한 요청 키로 모집 유형을 변경할 수 없다');
set local role anon;
select is((select to_jsonb(t)->>'kind' from public.list_research_tests() t where id=current_setting('test.survey')::uuid),'survey','공개 목록에서 독립 설문 유형을 식별한다');
select ok(not (select to_jsonb(t) ?| array['test_url','project_id','project_title','organizer_id','confirmation_code'] from public.list_research_tests() t
  where id=current_setting('test.linked_survey')::uuid),'연결한 비공개 프로젝트 정보와 응답 링크는 공개하지 않는다');
select throws_ok($$select public.publish_research_survey(null,null,null,null,null,null,null)$$,'42501',null,'비회원은 설문을 등록할 수 없다');
select throws_ok($$select public.submit_research_survey_completion(current_setting('test.survey')::uuid)$$,'42501',null,'비회원은 응답 완료를 신고할 수 없다');
select throws_ok($$select public.reject_research_survey_completion(null)$$,'42501',null,'비회원은 응답 완료 신고를 거절할 수 없다');

set local role authenticated;
set local request.jwt.claim.sub = '34000000-0000-4000-8000-000000000004';
select throws_ok($$select public.publish_research_survey(null,null,null,null,null,null,null)$$,'P0001','VERIFIED_UNIVERSITY_REQUIRED','학교 인증은 독립 설문에도 필요하다');
select throws_ok($$select public.reject_research_survey_completion(null)$$,'P0001','VERIFIED_UNIVERSITY_REQUIRED','학교 인증 없이 신고를 거절할 수 없다');
set local request.jwt.claim.sub = '34000000-0000-4000-8000-000000000002';
select throws_ok($$select public.publish_research_survey('34100000-0000-4000-8000-000000000003',current_setting('test.survey_project')::uuid,
  '학교 생활 설문','외부 폼에서 설문에 응답해 주세요.','https://forms.gle/sample123',1,1)$$,'P0001','RESEARCH_PROJECT_OWNER_REQUIRED','다른 사용자의 비공개 프로젝트에 설문을 연결할 수 없다');
select is(jsonb_array_length(public.my_research_work()->'participating'),0,'신청하지 않으면 참여 링크가 없다');
select throws_ok($$select public.submit_research_survey_completion(current_setting('test.survey')::uuid)$$,'P0001','RESEARCH_APPLICATION_REQUIRED','설문에 신청하지 않으면 완료 신고를 할 수 없다');
select set_config('test.survey_entry',public.apply_research_test(current_setting('test.survey')::uuid)::text,true);
select is(public.my_research_work()#>>'{participating,0,test_url}','https://xn--vv4b11d.xn--3e0b707e/form','신청한 참여자는 저장된 국제화 도메인 주소를 그대로 받는다');
select is(public.my_research_work()#>>'{participating,0,kind}','survey','내 참여 내역에서도 설문을 식별한다');
select is(public.my_research_work()#>>'{participating,0,status}','applied','주소 조회는 응답 완료로 기록되지 않는다');
select set_config('test.survey_code',coalesce(public.my_research_work()#>>'{participating,0,confirmation_code}',''),true);
select matches(current_setting('test.survey_code'),
  '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$','참여자는 완료 신고 전에 무작위 확인 코드를 받는다');
select isnt(current_setting('test.survey_code'),current_setting('test.survey_entry'),'외부 확인 코드는 내부 참여 식별자와 분리된다');
select throws_ok($$select confirmation_code from public.research_participations$$,'42501',null,'인증 회원도 테이블에서 코드를 직접 조회할 수 없다');
select throws_ok($$select public.submit_research_feedback(current_setting('test.survey')::uuid,'외부 응답 원문을 복사하지 않습니다.')$$,'P0001','RESEARCH_WRONG_KIND','설문 모집은 응답 텍스트를 받지 않는다');
set local request.jwt.claim.sub = '34000000-0000-4000-8000-000000000001';
select is((select p->>'confirmation_code' from jsonb_array_elements(public.my_research_work()->'organized') t
  cross join lateral jsonb_array_elements(t->'participants') p where p->>'id'=current_setting('test.survey_entry')),
  null::text,'완료 신고 전에는 진행자에게 대조 코드를 노출하지 않는다');
select throws_ok($$select public.confirm_research_participation(current_setting('test.survey_entry')::uuid)$$,'P0001','RESEARCH_FEEDBACK_REQUIRED','완료 신고 없이 진행자가 보상을 지급할 수 없다');
set local request.jwt.claim.sub = '34000000-0000-4000-8000-000000000002';
select lives_ok($$select public.submit_research_survey_completion(current_setting('test.survey')::uuid)$$,'신청자가 응답 완료를 직접 신고한다');
select lives_ok($$select public.submit_research_survey_completion(current_setting('test.survey')::uuid)$$,'응답 완료 신고를 재시도할 수 있다');
select is(public.my_research_work()#>>'{participating,0,confirmation_code}',nullif(current_setting('test.survey_code'),''),'신고를 재시도해도 코드는 바뀌지 않는다');
select is((public.my_research_credits()->>'available')::bigint,3::bigint,'완료 신고만으로는 크레딧이 지급되지 않는다');
select throws_ok($$select public.confirm_research_participation(current_setting('test.survey_entry')::uuid)$$,'P0001','RESEARCH_TEST_UNAVAILABLE','참여자가 보상을 직접 지급할 수 없다');
set local request.jwt.claim.sub = '34000000-0000-4000-8000-000000000003';
select set_config('test.rejected_entry',public.apply_research_test(current_setting('test.survey')::uuid)::text,true);
select ok((public.my_research_work()#>>'{participating,0,confirmation_code}' <> current_setting('test.survey_code')) is true,
  '같은 설문에서도 참여별 코드가 다르다');
select ok(not exists (select 1 from jsonb_array_elements(public.my_research_work()->'participating') p
  where p->>'id'=current_setting('test.survey_entry')),'다른 참여자의 확인 내역을 조회할 수 없다');
set local request.jwt.claim.sub = '34000000-0000-4000-8000-000000000001';
select throws_ok($$select public.reject_research_survey_completion(current_setting('test.rejected_entry')::uuid)$$,
  'P0001','RESEARCH_SURVEY_COMPLETION_REQUIRED','진행자도 아직 신고되지 않은 참여를 거절할 수 없다');
set local request.jwt.claim.sub = '34000000-0000-4000-8000-000000000003';
select lives_ok($$select public.submit_research_survey_completion(current_setting('test.survey')::uuid)$$,'두 번째 신청자가 설문 응답 완료를 신고한다');
select throws_ok($$select public.reject_research_survey_completion(current_setting('test.rejected_entry')::uuid)$$,
  'P0001','RESEARCH_TEST_UNAVAILABLE','참여자는 자신의 신고를 거절할 수 없다');
set local request.jwt.claim.sub = '34000000-0000-4000-8000-000000000002';
select throws_ok($$select public.reject_research_survey_completion(current_setting('test.rejected_entry')::uuid)$$,
  'P0001','RESEARCH_TEST_UNAVAILABLE','다른 학교 인증 회원도 신고를 거절할 수 없다');
set local request.jwt.claim.sub = '34000000-0000-4000-8000-000000000001';
select is((select p->>'status' from jsonb_array_elements(public.my_research_work()->'organized') t
  cross join lateral jsonb_array_elements(t->'participants') p where p->>'id'=current_setting('test.survey_entry')),
  'submitted','진행자는 제출된 완료 신고를 확인할 수 있다');
select is((select p->>'confirmation_code' from jsonb_array_elements(public.my_research_work()->'organized') t
  cross join lateral jsonb_array_elements(t->'participants') p where p->>'id'=current_setting('test.survey_entry')),
  current_setting('test.survey_code'),'신고 후 진행자는 참여자와 같은 확인 코드를 받는다');
select lives_ok($$select public.confirm_research_participation(current_setting('test.survey_entry')::uuid)$$,'진행자가 확인한 뒤 예약 크레딧을 지급한다');
select throws_ok($$select public.reject_research_survey_completion(current_setting('test.survey_entry')::uuid)$$,
  'P0001','RESEARCH_PARTICIPATION_ALREADY_CONFIRMED','이미 보상을 지급한 신고는 거절할 수 없다');
select throws_ok($$select public.close_research_test(current_setting('test.survey')::uuid)$$,'P0001','RESEARCH_PENDING_FEEDBACK','미처리 신고가 있는 동안 종료할 수 없다');
select lives_ok($$select public.reject_research_survey_completion(current_setting('test.rejected_entry')::uuid)$$,'진행자는 미처리 신고를 거절할 수 있다');
select lives_ok($$select public.reject_research_survey_completion(current_setting('test.rejected_entry')::uuid)$$,'거절 재시도는 안전하다');
select throws_ok($$select public.confirm_research_participation(current_setting('test.rejected_entry')::uuid)$$,
  'P0001','RESEARCH_PARTICIPATION_REJECTED','거절한 신고에는 보상을 지급할 수 없다');
select is((select p->>'status' from jsonb_array_elements(public.my_research_work()->'organized') t
  cross join lateral jsonb_array_elements(t->'participants') p where p->>'id'=current_setting('test.rejected_entry')),
  'rejected','진행자 화면에 거절 상태를 반환한다');
select is((public.my_research_credits()->>'reserved')::bigint,2::bigint,'거절만으로는 예약된 보상을 환급하지 않는다');
set local request.jwt.claim.sub = '34000000-0000-4000-8000-000000000003';
select is(public.my_research_work()#>>'{participating,0,status}','rejected','참여자에게도 거절 상태를 반환한다');
select is(public.my_research_work()#>>'{participating,0,test_url}',null::text,'거절된 참여에는 열려 있는 설문의 링크를 반환하지 않는다');
select throws_ok($$select public.submit_research_survey_completion(current_setting('test.survey')::uuid)$$,
  'P0001','RESEARCH_PARTICIPATION_REJECTED','거절된 설문 신고를 다시 제출할 수 없다');
select is((public.my_research_credits()->>'available')::bigint,3::bigint,'거절된 참여의 잔액은 그대로 유지된다');
set local request.jwt.claim.sub = '34000000-0000-4000-8000-000000000001';
select lives_ok($$select public.close_research_test(current_setting('test.survey')::uuid)$$,'프로젝트가 없는 설문도 종료할 수 있다');
select lives_ok($$select public.close_research_test(current_setting('test.survey')::uuid)$$,'종료 재시도로 중복 환급하지 않는다');
select is((public.my_research_credits()->>'available')::bigint,1::bigint,'종료 시 독립 설문의 미사용 예약을 환급한다');
select is((public.my_research_credits()->>'reserved')::bigint,1::bigint,'종료 시 다른 설문의 예약은 건드리지 않는다');
set local request.jwt.claim.sub = '34000000-0000-4000-8000-000000000002';
select is((public.my_research_credits()->>'available')::bigint,4::bigint,'명시적 확인 뒤 참여자에게 보상이 지급된다');
select is(public.my_research_work()#>>'{participating,0,test_url}',null::text,'종료한 설문 링크는 더 이상 노출하지 않는다');
select public.apply_research_test(current_setting('test.linked_survey')::uuid);
select is((select p->>'confirmation_code' from jsonb_array_elements(public.my_research_work()->'participating') p
  where p->>'test_id'=current_setting('test.linked_survey')),null::text,'프로젝트에 연결한 설문은 기존 참여 흐름을 유지한다');
reset role;
select ok(exists(select 1 from public.research_tests where title='학교 생활 설문' and project_id is null),'독립 설문에는 프로젝트가 저장되지 않는다');
select is((select feedback from public.research_participations where id=current_setting('test.survey_entry')::uuid),null::text,'설문 완료 기록에 응답 원문은 저장되지 않는다');
select ok(exists(select 1 from public.research_participations where id=current_setting('test.rejected_entry')::uuid
  and survey_attested and submitted_at is not null and rejected_at is not null and confirmed_at is null),
  '거절은 원래 신고와 함께 별도 이벤트로 기록된다');
select results_eq($$select kind, available_delta, reserved_delta from public.research_credit_ledger
  where test_id=current_setting('test.survey')::uuid order by sequence$$,
  $$values ('reserve'::text,-2::bigint,2::bigint),('spend',0,-1),('award',1,0),('release',1,-1)$$,
  '원장에는 승인 보상 한 건과 미지급 예약 환급 한 건만 남는다');
select is_empty($$select a.user_id from public.research_credit_accounts a left join (
  select user_id, sum(available_delta) available, sum(reserved_delta) reserved
  from public.research_credit_ledger group by user_id
) l using (user_id) where a.user_id::text like '34000000-0000-4000-8000-00000000000%'
  and (a.available,a.reserved) is distinct from (l.available,l.reserved)$$,'계정 잔액과 원장 합계가 일치한다');

select * from finish();
rollback;
