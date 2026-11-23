begin;
select plan(44);

insert into public.universities (id,name,short_name) values
  ('32000000-0000-4000-8000-000000000042','리서치 테스트대학교','리서치대');
insert into public.university_email_domains (university_id,email_domain) values
  ('32000000-0000-4000-8000-000000000042','research-test.example');
insert into auth.users (id,email,email_confirmed_at,raw_app_meta_data) values
  ('32000000-0000-4000-8000-000000000001','owner@research-test.example',now(),'{"provider":"google","providers":["google"]}'),
  ('32000000-0000-4000-8000-000000000002','tester@research-test.example',now(),'{"provider":"google","providers":["google"]}'),
  ('32000000-0000-4000-8000-000000000003','other@research-test.example',now(),'{"provider":"google","providers":["google"]}'),
  ('32000000-0000-4000-8000-000000000004','visitor@research-test.example',now(),'{"provider":"email","providers":["email"]}');
insert into auth.identities (provider_id,user_id,identity_data,provider) select
  'research-' || id, id, jsonb_build_object('sub','research-' || id,'email',email,'email_verified',true,
    'custom_claims',jsonb_build_object('hd','research-test.example')), 'google'
from auth.users where id::text like '32000000-0000-4000-8000-00000000000%' and raw_app_meta_data->>'provider' = 'google';
insert into public.profiles (id,nickname,university_id,major,bio,skills,interests,preferred_category)
select id, '리서치 테스터', '32000000-0000-4000-8000-000000000042', '전공', '소개', '{React}', '{협업}', 'research'
from auth.users where id::text like '32000000-0000-4000-8000-00000000000%';

set local role authenticated;
set local request.jwt.claim.sub = '32000000-0000-4000-8000-000000000004';
set local request.jwt.claims = '{"amr":[{"method":"oauth"}]}';
select throws_ok($$select public.my_research_credits()$$,'P0001','VERIFIED_UNIVERSITY_REQUIRED','학교 Google 인증이 없는 계정은 원장을 사용할 수 없다');
select throws_ok($$select public.my_research_work()$$,'P0001','VERIFIED_UNIVERSITY_REQUIRED','학교 Google 인증이 없는 계정은 비공개 참여 내역을 읽을 수 없다');
set local request.jwt.claim.sub = '32000000-0000-4000-8000-000000000001';
select set_config('test.research_project',public.create_project('리서치 프로젝트','리서치 테스트 프로젝트 설명입니다','research','private')::text,true);
select is((public.my_research_credits()->>'available')::bigint,3::bigint,'첫 이용에 3 크레딧을 지급한다');
select is(jsonb_array_length(public.my_research_credits()->'entries'),1,'첫 지급은 원장에 정확히 한 번 기록된다');
select throws_ok($$select public.publish_research_test('32100000-0000-4000-8000-000000000002',current_setting('test.research_project')::uuid,'사용성 테스트','앱을 사용한 후 문제점을 알려 주세요.','https://example.org/test',4,1)$$,'P0001','RESEARCH_INSUFFICIENT_CREDITS','잔액을 초과해서 게시할 수 없다');
select throws_ok($$select public.publish_research_test('32100000-0000-4000-8000-000000000002',current_setting('test.research_project')::uuid,'사용성 테스트','앱을 사용한 후 문제점을 알려 주세요.','javascript:alert(1)',2,1)$$,'P0001','RESEARCH_INVALID_DETAILS','HTTPS 외부 주소만 허용한다');
select set_config('test.research_test',public.publish_research_test('32100000-0000-4000-8000-000000000001',current_setting('test.research_project')::uuid,'사용성 테스트','앱을 사용한 후 문제점을 알려 주세요.','https://example.org/test',2,1)::text,true);
select is(public.publish_research_test('32100000-0000-4000-8000-000000000001',current_setting('test.research_project')::uuid,'사용성 테스트','앱을 사용한 후 문제점을 알려 주세요.','https://example.org/test',2,1),current_setting('test.research_test')::uuid,'동일 게시 재시도는 같은 테스트를 반환한다');
select throws_ok($$select public.publish_research_test('32100000-0000-4000-8000-000000000001',current_setting('test.research_project')::uuid,'수정된 모집글','앱을 사용한 후 문제점을 알려 주세요.','https://example.org/test',2,1)$$,'P0001','RESEARCH_REQUEST_CONFLICT','같은 게시 키로 다른 내용을 올릴 수 없다');
select is((public.my_research_credits()->>'available')::bigint,1::bigint,'게시 시 슬롯 보상 전액이 차감된다');
select is((public.my_research_credits()->>'reserved')::bigint,2::bigint,'게시 시 슬롯 보상 전액이 예약된다');
select throws_ok($$select public.apply_research_test(current_setting('test.research_test')::uuid)$$,'P0001','RESEARCH_OWN_TEST','진행자는 자기 테스트에 신청할 수 없다');

set local role anon;
select is((select title from public.list_research_tests() where id=current_setting('test.research_test')::uuid),'사용성 테스트','비회원은 게시된 모집글을 읽을 수 있다');
select ok(not (select to_jsonb(t) ?| array['project_id','organizer_id','test_url'] from public.list_research_tests() t where id=current_setting('test.research_test')::uuid),'공개 목록에 프로젝트나 진행자 식별자 및 테스트 링크가 없다');
select throws_ok($$select public.apply_research_test(current_setting('test.research_test')::uuid)$$,'42501',null,'비회원 신청은 거절한다');

set local role authenticated;
set local request.jwt.claim.sub = '32000000-0000-4000-8000-000000000002';
select throws_ok($$select public.publish_research_test('32100000-0000-4000-8000-000000000002',current_setting('test.research_project')::uuid,'사용성 테스트','앱을 사용한 후 문제점을 알려 주세요.','https://example.org/test',1,1)$$,'P0001','RESEARCH_PROJECT_OWNER_REQUIRED','타인 프로젝트에 모집을 게시할 수 없다');
select set_config('test.research_entry',public.apply_research_test(current_setting('test.research_test')::uuid)::text,true);
select throws_ok($$select public.apply_research_test(current_setting('test.research_test')::uuid)$$,'P0001','RESEARCH_ALREADY_APPLIED','중복 신청이 거절된다');
select is(public.my_research_work()#>>'{participating,0,test_url}','https://example.org/test','신청자에게만 참여 링크를 표시한다');
select throws_ok($$select public.submit_research_feedback(current_setting('test.research_test')::uuid,'  ')$$,'P0001','RESEARCH_INVALID_FEEDBACK','피드백 원문 없이 완료로 표시할 수 없다');
select throws_ok($$select public.confirm_research_participation(current_setting('test.research_entry')::uuid)$$,'P0001','RESEARCH_TEST_UNAVAILABLE','참여자는 자신에게 크레딧을 지급할 수 없다');

set local request.jwt.claim.sub = '32000000-0000-4000-8000-000000000001';
select throws_ok($$select public.confirm_research_participation(current_setting('test.research_entry')::uuid)$$,'P0001','RESEARCH_FEEDBACK_REQUIRED','신청 상태만으로는 크레딧을 지급할 수 없다');
set local request.jwt.claim.sub = '32000000-0000-4000-8000-000000000002';
select lives_ok($$select public.submit_research_feedback(current_setting('test.research_test')::uuid,'검색 결과를 찾기 어려웠습니다.')$$,'신청자가 피드백을 제출한다');
select is((public.my_research_credits()->>'available')::bigint,3::bigint,'피드백 제출만으로 크레딧이 지급되지 않는다');

set local request.jwt.claim.sub = '32000000-0000-4000-8000-000000000003';
select is(jsonb_array_length(public.my_research_work()->'participating'),0,'다른 학생의 참여 및 피드백은 표시되지 않는다');
select throws_ok($$select public.submit_research_feedback(current_setting('test.research_test')::uuid,'신청하지 않은 사용자 의견')$$,'P0001','RESEARCH_APPLICATION_REQUIRED','신청하지 않은 사용자는 제출할 수 없다');
select throws_ok($$select * from public.research_credit_ledger$$,'42501',null,'원장 테이블의 원본은 클라이언트에 공개하지 않는다');
select throws_ok($$update public.research_credit_ledger set available_delta = 9$$,'42501',null,'클라이언트는 원장 기록을 수정할 수 없다');
select throws_ok($$update public.research_credit_accounts set available = 999$$,'42501',null,'클라이언트는 크레딧 잔액을 수정할 수 없다');
select lives_ok($$select public.apply_research_test(current_setting('test.research_test')::uuid)$$,'마지막 슬롯을 두 번째 참여자가 차지한다');
reset role;
insert into auth.users (id,email,email_confirmed_at,raw_app_meta_data) values
  ('32000000-0000-4000-8000-000000000005','extra@research-test.example',now(),'{"provider":"google","providers":["google"]}');
insert into auth.identities (provider_id,user_id,identity_data,provider) values
  ('research-extra','32000000-0000-4000-8000-000000000005','{"sub":"research-extra","email":"extra@research-test.example","email_verified":true,"custom_claims":{"hd":"research-test.example"}}','google');
insert into public.profiles (id,nickname,university_id,major,bio,skills,interests,preferred_category) values
  ('32000000-0000-4000-8000-000000000005','추가 테스터','32000000-0000-4000-8000-000000000042','전공','소개','{React}','{협업}','research');
set local role authenticated;
set local request.jwt.claim.sub = '32000000-0000-4000-8000-000000000005';
select throws_ok($$select public.apply_research_test(current_setting('test.research_test')::uuid)$$,'P0001','RESEARCH_TEST_FULL','정원 초과 신청을 거절한다');

set local request.jwt.claim.sub = '32000000-0000-4000-8000-000000000001';
select is((select p->>'feedback' from jsonb_array_elements(public.my_research_work()#>'{organized,0,participants}') p
  where p->>'id' = current_setting('test.research_entry')),'검색 결과를 찾기 어려웠습니다.','진행자는 제출된 피드백을 읽을 수 있다');
select throws_ok($$select public.close_research_test(current_setting('test.research_test')::uuid)$$,'P0001','RESEARCH_PENDING_FEEDBACK','지급 대기 중인 피드백을 먼저 처리해야 한다');
select lives_ok($$select public.confirm_research_participation(current_setting('test.research_entry')::uuid)$$,'진행자의 명시적인 확인으로 보상한다');
select lives_ok($$select public.confirm_research_participation(current_setting('test.research_entry')::uuid)$$,'확인 재시도는 안전하다');
select is((public.my_research_credits()->>'reserved')::bigint,1::bigint,'확인은 예약 잔액에서 한 번 감산한다');
select lives_ok($$select public.close_research_test(current_setting('test.research_test')::uuid)$$,'미지급 슬롯을 남기고 모집을 종료할 수 있다');
select lives_ok($$select public.close_research_test(current_setting('test.research_test')::uuid)$$,'종료 재시도는 안전하다');
select is((public.my_research_credits()->>'available')::bigint,2::bigint,'미사용 예약 잔액이 한 번만 환급된다');
select is((public.my_research_credits()->>'reserved')::bigint,0::bigint,'종료 후 남은 예약 잔액은 없다');
select is((select count(*) from public.list_research_tests() where id=current_setting('test.research_test')::uuid),0::bigint,'종료된 모집은 공개 목록에서 사라진다');

set local request.jwt.claim.sub = '32000000-0000-4000-8000-000000000002';
select is((public.my_research_credits()->>'available')::bigint,4::bigint,'참여자 잔액에 확인된 보상만 들어온다');
select is((select string_agg(e->>'kind',',' order by (e->>'sequence')::bigint) from jsonb_array_elements(public.my_research_credits()->'entries') e),'starter,award','본인 원장에는 지급·보상만 기록되며 진행자의 거래는 노출되지 않는다');
set local request.jwt.claim.sub = '32000000-0000-4000-8000-000000000003';
select throws_ok($$select public.submit_research_feedback(current_setting('test.research_test')::uuid,'종료 후 제출하는 피드백')$$,'P0001','RESEARCH_TEST_UNAVAILABLE','종료된 테스트에는 제출할 수 없다');
select is(public.my_research_work()#>>'{participating,0,test_url}',null::text,'종료 후에는 참여 링크를 표시하지 않는다');

reset role;
select ok((select bool_and(a.available = b.available and a.reserved = b.reserved)
  from public.research_credit_accounts a join (
    select user_id, sum(available_delta) available, sum(reserved_delta) reserved
    from public.research_credit_ledger group by user_id
  ) b using (user_id) where a.user_id::text like '32000000-0000-4000-8000-00000000000%'),
  '계정 잔액은 원장의 누적 변동과 일치한다');

select * from finish();
rollback;
