begin;
select no_plan();

insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data) values
  ('15110000-0000-4000-8000-000000000001','matching-owner@matching-test.example',now(),'{"provider":"google","providers":["google"]}','{"email_verified":true}'),
  ('15110000-0000-4000-8000-000000000002','matching-member@matching-test.example',now(),'{"provider":"google","providers":["google"]}','{"email_verified":true}'),
  ('15110000-0000-4000-8000-000000000003','matching-stranger@matching-test.example',now(),'{"provider":"google","providers":["google"]}','{"email_verified":true}'),
  ('15110000-0000-4000-8000-000000000004','matching-no-profile@matching-test.example',now(),'{"provider":"google","providers":["google"]}','{"email_verified":true}');
insert into public.universities (id,name,short_name) values ('15110000-0000-4000-8000-000000000042','매칭테스트대학교','매칭테스트대');
insert into public.university_email_domains (university_id,email_domain) values ('15110000-0000-4000-8000-000000000042','matching-test.example');
insert into auth.identities(provider_id, user_id, identity_data, provider)
select id::text, id, jsonb_build_object('sub',id,'email',email,'email_verified',true,'custom_claims',jsonb_build_object('hd','matching-test.example')), 'google'
from auth.users where id::text like '15110000-0000-4000-8000-00000000000%';
insert into public.profiles (id,nickname,university_id,major,bio,skills,interests,preferred_category)
select id, '매칭테스터', '15110000-0000-4000-8000-000000000042', '디자인', '자기소개 문장', '{React}', '{협업}', 'side_project'
from auth.users where id::text like '15110000-0000-4000-8000-00000000000%' and id::text not like '%004';
insert into public.projects (id,owner_id,title,description,category,status,visibility) values
  ('15110000-0000-4000-8000-000000000011','15110000-0000-4000-8000-000000000001','비공개 원본','공개하면 안 되는 원본 내용입니다','side_project','paused','private'),
  ('15110000-0000-4000-8000-000000000012','15110000-0000-4000-8000-000000000003','공개 원본','새 프로젝트에는 복사하지 않을 내용입니다','side_project','completed','public'),
  ('15110000-0000-4000-8000-000000000013','15110000-0000-4000-8000-000000000003','진행 중 공개 원본','현재 진행 중인 공개 프로젝트입니다','side_project','active','public');

set local role anon;
select throws_ok($$select * from public.list_matching_opportunities()$$,'42501',null,'비회원은 모집글 API에 접근할 수 없다');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"amr":[{"method":"oauth"}]}';
set local request.jwt.claim.sub = '15110000-0000-4000-8000-000000000004';
select throws_ok($$select * from public.list_matching_opportunities()$$,'P0001','PROFILE_REQUIRED','프로필이 없는 계정은 매칭에 접근할 수 없다');
set local request.jwt.claim.sub = '15110000-0000-4000-8000-000000000001';
select throws_ok($$select public.create_matching_opportunity('idea','반쪽 아이디어','팀원과 함께 실험해 볼 아이디어입니다',array['개발'])$$,'P0001','MATCHING_INVALID_TYPE_FIELDS','반쪽 아이디어에는 도움이 필요한 부분이 필요하다');
select throws_ok($$select public.create_matching_opportunity('idea','반쪽 아이디어','팀원과 함께 실험해 볼 아이디어입니다',array['개발'],p_gap=>E'\n\t\n')$$,'P0001','MATCHING_INVALID_TYPE_FIELDS','줄바꿈과 탭으로만 작성한 필수 항목은 허용하지 않는다');
select throws_ok($$select public.create_matching_opportunity('idea','반쪽 아이디어','팀원과 함께 실험해 볼 아이디어입니다',array['개발'],p_gap=>'모바일 화면',p_competition=>'해커톤')$$,'P0001','MATCHING_INVALID_TYPE_FIELDS','다른 유형의 필드를 섞어 등록할 수 없다');
select set_config('test.matching_idea', public.create_matching_opportunity('idea','반쪽 아이디어','팀원과 함께 실험해 볼 아이디어입니다',array['개발'],p_gap=>'모바일 화면')::text,true);
select throws_ok($$select public.create_matching_opportunity('reboot','리부트 제안','이전 프로젝트에 새 방향을 제시합니다',array['기획'],p_source_project_id=>'15110000-0000-4000-8000-000000000011')$$,'P0001','MATCHING_REBOOT_SOURCE_UNAVAILABLE','소유자도 비공개 프로젝트를 리부트 원본으로 삼을 수 없다');
select throws_ok($$select public.create_matching_opportunity('reboot','리부트 제안','이전 프로젝트에 새 방향을 제시합니다',array['기획'],p_source_project_id=>'15110000-0000-4000-8000-000000000013')$$,'P0001','MATCHING_REBOOT_SOURCE_UNAVAILABLE','진행 중인 공개 프로젝트는 원본이 될 수 없다');
select set_config('test.matching_reboot', public.create_matching_opportunity('reboot','리부트 제안','이전 프로젝트에 새 방향을 제시합니다',array['기획'],p_source_project_id=>'15110000-0000-4000-8000-000000000012')::text,true);
select throws_ok($$select public.create_matching_opportunity('contest','공모전 팀 모집','모바일 서비스를 만드는 공모전입니다',array['개발'],p_competition=>'봄 해커톤',p_format=>'online',p_deadline=>now()-interval '1 hour')$$,'P0001','MATCHING_INVALID_TYPE_FIELDS','지난 마감일로 팀원을 모집할 수 없다');
select set_config('test.matching_contest', public.create_matching_opportunity('contest','공모전 팀 모집','모바일 서비스를 만드는 공모전입니다',array['개발'],p_skills=>array['React'],p_university_id=>'15110000-0000-4000-8000-000000000042',p_major=>'산업디자인',p_competition=>'봄 해커톤',p_format=>'online',p_deadline=>now()+interval '1 day')::text,true);
select is((select id from public.list_matching_opportunities('contest',false,'15110000-0000-4000-8000-000000000042','디자인','react','개발','해커톤','online') where id=current_setting('test.matching_contest')::uuid),current_setting('test.matching_contest')::uuid,'모집 유형, 대학, 전공, 역량, 역할, 대회 및 형식 필터를 함께 적용한다');
select is((select count(*) from public.list_matching_opportunities(p_skill=>'Vue') where id=current_setting('test.matching_contest')::uuid),0::bigint,'역량 불일치는 필터에서 제외된다');
select is((select count(*) from public.list_matching_opportunities(p_format=>'offline') where id=current_setting('test.matching_contest')::uuid),0::bigint,'대회 형식 불일치는 필터에서 제외된다');
select throws_ok($$select public.submit_matching_request(current_setting('test.matching_reboot')::uuid,'본인 지원 시도')$$,'P0001','MATCHING_OWN_OPPORTUNITY','작성자는 자신의 모집글에 지원할 수 없다');
select throws_ok($$update public.matching_opportunities set title='직접 변경'$$,'42501',null,'클라이언트는 모집글을 직접 수정할 수 없다');

set local request.jwt.claim.sub = '15110000-0000-4000-8000-000000000002';
select throws_ok($$select public.submit_matching_request(current_setting('test.matching_reboot')::uuid,'역할 없는 지원','일치하지 않는 역할')$$,'P0001','MATCHING_INVALID_ROLE','게시물에 없는 역할로 지원할 수 없다');
select throws_ok($$select public.submit_matching_request(current_setting('test.matching_reboot')::uuid,'잘못된 시간대 지원',null,'Not/A_Timezone')$$,'P0001','MATCHING_INVALID_TIMEZONE','DB가 알 수 없는 시간대를 거절한다');
select set_config('test.matching_request',public.submit_matching_request(current_setting('test.matching_reboot')::uuid,'리부트 기획에 참여할 수 있습니다','기획','Asia/Seoul')::text,true);
select set_config('test.matching_idea_request',public.submit_matching_request(current_setting('test.matching_idea')::uuid,'아이디어 검증에 참여하고 싶습니다')::text,true);
select throws_ok($$select public.submit_matching_request(current_setting('test.matching_reboot')::uuid,'중복 신청 시도')$$,'P0001','MATCHING_DUPLICATE_REQUEST','한 모집글에는 한 번만 지원할 수 있다');
select is((select status from public.list_matching_requests(false) where id=current_setting('test.matching_request')::uuid),'pending','신청자는 자신의 대기 상태를 확인할 수 있다');
select throws_ok($$select public.decide_matching_request(current_setting('test.matching_request')::uuid,true)$$,'P0001','MATCHING_REQUEST_UNAVAILABLE','신청자는 자기 요청을 승인할 수 없다');
select throws_ok($$update public.matching_requests set status='accepted'$$,'42501',null,'클라이언트가 지원 상태를 직접 변경할 수 없다');

set local request.jwt.claim.sub = '15110000-0000-4000-8000-000000000003';
select set_config('test.matching_second_request',public.submit_matching_request(current_setting('test.matching_reboot')::uuid,'다른 역할로 리부트에 참여하고 싶습니다')::text,true);
select is((select count(*) from public.list_matching_requests(false) where id=current_setting('test.matching_request')::uuid),0::bigint,'제3자는 다른 지원자의 정보를 볼 수 없다');
select is((select count(*) from public.list_matching_requests(true) where id=current_setting('test.matching_request')::uuid),0::bigint,'제3자는 다른 작성자가 받은 요청을 볼 수 없다');

set local request.jwt.claim.sub = '15110000-0000-4000-8000-000000000001';
select is((select selected_role from public.list_matching_requests(true) where id=current_setting('test.matching_request')::uuid),'기획','작성자는 선택한 지원 역할을 확인할 수 있다');
select is((select timezone from public.list_matching_requests(true) where id=current_setting('test.matching_request')::uuid),'Asia/Seoul','작성자는 지원자의 시간대를 확인할 수 있다');
select is(public.decide_matching_request(current_setting('test.matching_idea_request')::uuid,false),null::uuid,'거절하는 경우 프로젝트를 만들지 않는다');
reset role;
create function pg_temp.fail_matching_membership() returns trigger language plpgsql as $$
begin
  if new.membership_role = 'member' then raise exception 'TEST_MEMBERSHIP_FAILED'; end if;
  return new;
end;
$$;
create trigger test_matching_membership_failure after insert on public.project_members
for each row execute function pg_temp.fail_matching_membership();
set local role authenticated;
select throws_ok($$select public.decide_matching_request(current_setting('test.matching_request')::uuid,true)$$,'P0001','TEST_MEMBERSHIP_FAILED','팀원 등록이 실패하면 승인 전체가 실패한다');
select is((select status from public.list_matching_requests(true) where id=current_setting('test.matching_request')::uuid),'pending','실패한 승인 후 지원 상태가 그대로 남는다');
reset role;
select is((select count(*) from public.projects where title='리부트 제안' and owner_id='15110000-0000-4000-8000-000000000001'),0::bigint,'팀원 등록 실패 시 새 프로젝트도 롤백된다');
select is((select project_id from public.matching_opportunities where id=current_setting('test.matching_reboot')::uuid),null::uuid,'실패한 승인으로 프로젝트 연결이 남지 않는다');
drop trigger test_matching_membership_failure on public.project_members;
set local role authenticated;
select set_config('test.matching_project',public.decide_matching_request(current_setting('test.matching_request')::uuid,true)::text,true);
select isnt(current_setting('test.matching_project')::uuid,'15110000-0000-4000-8000-000000000012'::uuid,'리부트 승인 결과는 원본이 아닌 새 프로젝트다');
select is((select visibility::text from public.projects where id=current_setting('test.matching_project')::uuid),'private','매칭을 통해 만든 팀 프로젝트는 비공개다');
select is((select description from public.projects where id=current_setting('test.matching_project')::uuid),'이전 프로젝트에 새 방향을 제시합니다','리부트 원본 설명은 새 프로젝트에 복사되지 않는다');
select is((select membership_role from public.project_members where project_id=current_setting('test.matching_project')::uuid and user_id=auth.uid()),'owner','작성자가 새 프로젝트 팀장이다');
select is(public.decide_matching_request(current_setting('test.matching_second_request')::uuid,true),current_setting('test.matching_project')::uuid,'후속 승인은 동일한 프로젝트에 합류시킨다');
select throws_ok($$select public.decide_matching_request(current_setting('test.matching_request')::uuid,true)$$,'P0001','MATCHING_REQUEST_DECIDED','이미 처리한 요청을 다시 승인할 수 없다');
select lives_ok($$select public.close_matching_opportunity(current_setting('test.matching_contest')::uuid)$$,'작성자가 모집을 마감할 수 있다');

set local request.jwt.claim.sub = '15110000-0000-4000-8000-000000000002';
select is((select status from public.list_matching_requests(false) where id=current_setting('test.matching_request')::uuid),'accepted','신청자가 수락 결과를 확인할 수 있다');
select is((select status from public.list_matching_requests(false) where id=current_setting('test.matching_idea_request')::uuid),'rejected','신청자가 거절 결과를 확인할 수 있다');
select is((select membership_role from public.project_members where project_id=current_setting('test.matching_project')::uuid and user_id=auth.uid()),'member','수락된 신청자가 팀원으로 등록된다');
select throws_ok($$select public.submit_matching_request(current_setting('test.matching_contest')::uuid,'이미 마감한 공모전 지원')$$,'P0001','MATCHING_OPPORTUNITY_CLOSED','마감된 모집에는 지원할 수 없다');
reset role;
update public.projects set visibility='private' where id='15110000-0000-4000-8000-000000000012';
set local role authenticated;
select is((select source_project_id from public.list_matching_opportunities(p_type=>'reboot') where id=current_setting('test.matching_reboot')::uuid),null::uuid,'공개 원본이 비공개로 바뀌면 원본 링크를 더 이상 공개하지 않는다');
reset role;
-- Simulate deletion of the generated project and accepted-request history, leaving a pending request.
insert into public.matching_requests(opportunity_id,applicant_id,message)
values(current_setting('test.matching_reboot')::uuid,'15110000-0000-4000-8000-000000000004','추가 지원 테스트');
select set_config('test.matching_pending',id::text,true) from public.matching_requests
where opportunity_id=current_setting('test.matching_reboot')::uuid and status='pending';
delete from public.matching_requests where opportunity_id=current_setting('test.matching_reboot')::uuid and status='accepted';
delete from public.projects where id=current_setting('test.matching_project')::uuid;
set local role authenticated;
set local request.jwt.claim.sub = '15110000-0000-4000-8000-000000000001';
select throws_ok($$select public.decide_matching_request(current_setting('test.matching_pending')::uuid,true)$$,'P0001','MATCHING_PROJECT_UNAVAILABLE','삭제된 프로젝트는 지원 기록이 없어져도 다시 생성되지 않는다');
reset role;
select * from finish();
rollback;
