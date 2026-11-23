begin;
select plan(26);

insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-4000-8000-000000000001','owner@campus-test.example',now()),
  ('00000000-0000-4000-8000-000000000002','member@campus-test.example',now()),
  ('00000000-0000-4000-8000-000000000003','visitor@personal.example',now()),
  ('00000000-0000-4000-8000-000000000004','unconfirmed@campus-test.example',null);
insert into public.universities (id,name,short_name) values
  ('00000000-0000-4000-8000-000000000042','테스트대학교','테스트대');
insert into public.university_email_domains (university_id,email_domain) values
  ('00000000-0000-4000-8000-000000000042','campus-test.example');
insert into auth.identities (provider_id,user_id,provider,identity_data)
select id::text,id,'google',jsonb_build_object('sub',id::text,'email',email,'email_verified',true,'custom_claims',jsonb_build_object('hd','campus-test.example'))
from auth.users where id in ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002');
insert into public.profiles (id,nickname,university_id,major,bio,skills,interests,preferred_category)
select id, '테스터', '00000000-0000-4000-8000-000000000042', '테스트 전공', '자기소개 문장', '{React}', '{협업}', 'side_project' from auth.users where id::text like '00000000-0000-4000-8000-00000000000%';

set local role authenticated;
set local request.jwt.claims = '{"amr":[{"method":"oauth"}]}';
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000003';
select throws_ok($$select public.verify_university_email()$$,'P0001','SCHOOL_DOMAIN_NOT_REGISTERED','개인 이메일은 학교가 선택돼 있어도 인증되지 않는다');
select throws_ok($$select public.create_project('검증 프로젝트','프로젝트 설명 테스트 문장','side_project','private',null,null)$$,'P0001','VERIFIED_UNIVERSITY_REQUIRED','미인증 사용자는 프로젝트를 생성할 수 없다');
select throws_ok($$insert into public.university_verifications (user_id,university_id,verified_email) values (auth.uid(),'00000000-0000-4000-8000-000000000042','fake@campus-test.example')$$,'42501',null,'클라이언트는 인증 상태를 직접 입력할 수 없다');
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000004';
select throws_ok($$select public.verify_university_email()$$,'P0001','CONFIRMED_EMAIL_REQUIRED','메일 확인을 마치지 않은 학교 계정은 인증되지 않는다');
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
select is(public.verify_university_email(),'00000000-0000-4000-8000-000000000042'::uuid,'확인된 학교 메일은 DB가 검증한다');
select set_config('test.private_project',public.create_project('비공개 프로젝트','프로젝트 설명 테스트 문장','side_project','private',null,null)::text,true);
select set_config('test.public_project',public.create_project('공개 프로젝트','프로젝트 설명 테스트 문장','side_project','public',null,null)::text,true);
select is((select membership_role from public.project_members where project_id=current_setting('test.private_project')::uuid and user_id=auth.uid()), 'owner', '생성자 권한이 원자적으로 등록된다');
select set_config('test.invite_token',(select token from public.create_project_invite(current_setting('test.private_project')::uuid)),true);
select set_config('test.extra_invite_token',(select token from public.create_project_invite(current_setting('test.private_project')::uuid)),true);
select ok(current_setting('test.invite_token') ~ '^[0-9a-f]{64}$','초대 토큰은 64자리 소문자 hex이다');
select set_config('test.revoked_token',token,true), set_config('test.revoked_id', invite_id::text,true)
from public.create_project_invite(current_setting('test.private_project')::uuid);
select public.revoke_project_invite(current_setting('test.revoked_id')::uuid);
select set_config('test.expired_token',token,true), set_config('test.expired_id',invite_id::text,true)
from public.create_project_invite(current_setting('test.private_project')::uuid);
reset role;
update public.project_invitations set created_at=now()-interval '8 days',expires_at=now()-interval '1 day'
where id=current_setting('test.expired_id')::uuid;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-000000000002';
select public.verify_university_email();
select is((select count(*) from public.projects where id=current_setting('test.private_project')::uuid), 0::bigint, '팀원이 아닌 계정은 비공개 프로젝트에 접근할 수 없다');
select throws_ok($$select * from public.list_project_members(current_setting('test.private_project')::uuid)$$,'P0001','PROJECT_MEMBER_REQUIRED','프로젝트 팀원만 팀원 목록을 읽을 수 있다');
select throws_ok($$insert into public.project_members (project_id,user_id,membership_role) values(current_setting('test.private_project')::uuid,auth.uid(),'member')$$,'42501',null,'클라이언트 직접 요청으로 팀에 합류할 수 없다');
select throws_ok($$select * from public.create_project_invite(current_setting('test.private_project')::uuid)$$,'P0001','PROJECT_OWNER_REQUIRED','소유자가 아닌 계정은 초대를 만들 수 없다');
select throws_ok($$select public.accept_project_invite(current_setting('test.revoked_token'))$$,'P0001','INVITE_UNAVAILABLE','취소된 초대는 사용할 수 없다');
select throws_ok($$select public.accept_project_invite(current_setting('test.expired_token'))$$,'P0001','INVITE_UNAVAILABLE','만료된 초대는 사용할 수 없다');
select is(public.accept_project_invite(current_setting('test.invite_token')),current_setting('test.private_project')::uuid,'확인된 학생이 유효한 링크로 가입할 수 있다');
select is((select count(*) from public.projects where id=current_setting('test.private_project')::uuid),1::bigint,'가입 후 비공개 프로젝트를 읽을 수 있다');
select throws_ok($$select public.accept_project_invite(current_setting('test.invite_token'))$$,'P0001','INVITE_UNAVAILABLE','수락한 단일 사용 링크는 재사용할 수 없다');
select throws_ok($$select public.accept_project_invite(current_setting('test.extra_invite_token'))$$,'P0001','ALREADY_PROJECT_MEMBER','새 초대를 받아도 동일 회원은 중복 등록할 수 없다');
select is((select count(*) from public.project_members where project_id=current_setting('test.private_project')::uuid and user_id=auth.uid()),1::bigint,'동일 사용자가 중복 등록되지 않는다');
select throws_ok($$select token_hash from public.project_invitations$$,'42501',null,'초대 해시는 클라이언트에 노출되지 않는다');
select is((select count(*) from public.profiles where id='00000000-0000-4000-8000-000000000001'),0::bigint,'팀원이더라도 비공개 프로필 원본은 읽을 수 없다');
reset role;
update public.university_email_domains set is_active=false where email_domain='campus-test.example';
set local role authenticated;
select is(public.my_university_verification(),null::uuid,'학교 도메인이 비활성화되면 인증 효력이 사라진다');
select throws_ok($$select public.create_project('검증 프로젝트','프로젝트 설명 테스트 문장','side_project','private',null,null)$$,'P0001','VERIFIED_UNIVERSITY_REQUIRED','효력이 사라진 인증으로 생성할 수 없다');
reset role;
set local role anon;
select is((select count(*) from public.projects where id=current_setting('test.public_project')::uuid),1::bigint,'비회원에게는 공개 프로젝트가 표시된다');
select is((select count(*) from public.projects where id=current_setting('test.private_project')::uuid),0::bigint,'비회원에게 비공개 프로젝트가 숨겨진다');
select throws_ok($$select owner_id from public.projects$$,'42501',null,'공개 프로젝트에서도 소유자 계정 식별자는 읽을 수 없다');
select throws_ok($$select public.verify_university_email()$$,'42501',null,'비회원은 인증 RPC를 호출할 수 없다');
select * from finish();
rollback;
