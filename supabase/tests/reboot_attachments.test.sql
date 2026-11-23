begin;
set local search_path = public, extensions;
select plan(49);

select is((select not public and file_size_limit=10485760 and allowed_mime_types=array['application/pdf','image/jpeg','image/png'] from storage.buckets where id='reboot-attachments'),true,'버킷은 비공개이며 파일 형식과 크기를 제한한다');

insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data) values
  ('17210000-0000-4000-8000-000000000001','reboot-owner@reboot-test.example',now(),'{"provider":"google","providers":["google"]}','{"email_verified":true}'),
  ('17210000-0000-4000-8000-000000000002','reboot-reader@reboot-test.example',now(),'{"provider":"google","providers":["google"]}','{"email_verified":true}'),
  ('17210000-0000-4000-8000-000000000003','reboot-unverified@reboot-test.example',now(),'{"provider":"google","providers":["google"]}','{"email_verified":true}');
insert into public.universities (id,name,short_name) values ('17210000-0000-4000-8000-000000000042','리부트 테스트대학교','리부트 테스트대');
insert into public.university_email_domains (university_id,email_domain) values ('17210000-0000-4000-8000-000000000042','reboot-test.example');
insert into auth.identities(provider_id, user_id, identity_data, provider)
select id::text, id, jsonb_build_object('sub',id,'email',email,'email_verified',true,'custom_claims',jsonb_build_object('hd','reboot-test.example')), 'google'
from auth.users where id in ('17210000-0000-4000-8000-000000000001','17210000-0000-4000-8000-000000000002');
insert into public.profiles (id,nickname,university_id,major,bio,skills,interests,preferred_category)
select id, '리부트테스터', '17210000-0000-4000-8000-000000000042', '디자인', '자기소개 문장', '{React}', '{협업}', 'side_project'
from auth.users where id in ('17210000-0000-4000-8000-000000000001','17210000-0000-4000-8000-000000000002');
insert into public.projects (id,owner_id,title,description,category,status,visibility) values
  ('17210000-0000-4000-8000-000000000011','17210000-0000-4000-8000-000000000002','공개 원본','복제하지 않을 공개 원본 설명입니다','side_project','completed','public'),
  ('17210000-0000-4000-8000-000000000012','17210000-0000-4000-8000-000000000001','비공개 원본','복제하지 않을 비공개 원본 설명입니다','side_project','paused','private');
insert into public.matching_opportunities(id,author_id,type,title,description,roles,source_project_id)
values ('17210000-0000-4000-8000-000000000013','17210000-0000-4000-8000-000000000001','reboot','기존 모집','기존 리부트 모집은 계속 표시합니다',array['기획'],'17210000-0000-4000-8000-000000000011');

set local role authenticated;
set local request.jwt.claims = '{"amr":[{"method":"oauth"}]}';
set local request.jwt.claim.sub = '17210000-0000-4000-8000-000000000001';
select throws_ok($$select public.create_matching_opportunity('reboot','예약 없는 리부트','오래된 작업에 새 방향을 제시합니다',array['기획'],p_reboot_prior_work=>'조사 초안',p_reboot_changes=>'일정과 역할 조정',p_reboot_request_id=>'17210000-0000-4000-8000-000000000018')$$,'P0001','MATCHING_REBOOT_ATTEMPT_UNAVAILABLE','파일 없이도 사전 예약이 필요하다');
select public.cancel_matching_reboot_attempt('17210000-0000-4000-8000-000000000019');
select throws_ok($$select public.begin_matching_reboot('17210000-0000-4000-8000-000000000019','늦은 예약.pdf')$$,'P0001','MATCHING_REBOOT_ATTEMPT_UNAVAILABLE','취소가 예약보다 먼저 처리돼도 늦은 예약을 막는다');
select public.begin_matching_reboot('17210000-0000-4000-8000-000000000021');
select lives_ok($$select public.create_matching_opportunity('reboot','리부트 제안','오래된 작업에 새 방향을 제시합니다',array['기획'],p_reboot_prior_work=>' 조사 초안 ',p_reboot_changes=>' 운영 인력이 없어 중단, 역할을 재분배 ',p_reboot_request_id=>'17210000-0000-4000-8000-000000000021')$$,'원본이나 파일 없이 새 리부트 게시');
select throws_ok($$select public.create_matching_opportunity('reboot','리부트 제안','오래된 작업에 새 방향을 제시합니다',array['기획'],p_source_project_id=>'17210000-0000-4000-8000-000000000011')$$,'P0001','MATCHING_REBOOT_DETAILS_REQUIRED','기존 RPC 호출 방식으로 필수 정보 생략 불가');
select public.begin_matching_reboot('17210000-0000-4000-8000-000000000022');
select lives_ok($$select public.create_matching_opportunity('reboot','원본 연결 모집','이전 작업에 새 방향을 제시합니다',array['기획'],p_source_project_id=>'17210000-0000-4000-8000-000000000011',p_reboot_prior_work=>'초안 작성',p_reboot_changes=>'일정과 역할을 조정',p_reboot_request_id=>'17210000-0000-4000-8000-000000000022')$$,'다른 사람이 소유한 적격 공개 원본 링크 허용');
select throws_ok($$select public.create_matching_opportunity('reboot','비공개 원본 모집','이전 작업에 새 방향을 제시합니다',array['기획'],p_source_project_id=>'17210000-0000-4000-8000-000000000012',p_reboot_prior_work=>'초안 작성',p_reboot_changes=>'일정과 역할을 조정',p_reboot_request_id=>'17210000-0000-4000-8000-000000000023')$$,'P0001','MATCHING_REBOOT_SOURCE_UNAVAILABLE','작성자가 소유해도 비공개 원본 링크 거절');
select is((select title from public.list_matching_opportunities('reboot') where id='17210000-0000-4000-8000-000000000013'),'기존 모집','기존 리부트 게시물 보존');
select set_config('test.reboot_path',public.begin_matching_reboot('17210000-0000-4000-8000-000000000024','작업 내역.pdf'),true);
select matches(current_setting('test.reboot_path'), '^[a-f0-9-]{36}$','파일명과 별개인 내부 경로를 예약한다');
select is(public.begin_matching_reboot('17210000-0000-4000-8000-000000000024','작업 내역.pdf'),current_setting('test.reboot_path'),'동일한 예약 재시도는 원래 경로를 반환한다');
select throws_ok($$select public.begin_matching_reboot(gen_random_uuid(),'../비공개.pdf')$$,'P0001','MATCHING_REBOOT_INVALID_FILENAME','경로처럼 생긴 파일명은 거절한다');
set local storage.operation = 'storage.object.upload';
select throws_ok($$insert into storage.objects(bucket_id,name,owner_id) values ('reboot-attachments','17210000-0000-4000-8000-000000000001/unreserved','17210000-0000-4000-8000-000000000001')$$,'42501',null,'예약되지 않은 경로에는 업로드할 수 없다');
-- Exercise the distinct probe and final JSON shapes of Storage v1.96.
reset role;
create function public.test_probe_reboot_upload(p_metadata jsonb, p_version text default null) returns void language plpgsql as $$
begin
  insert into storage.objects(bucket_id,name,owner_id,version,metadata)
    values ('reboot-attachments',current_setting('test.reboot_path'),'17210000-0000-4000-8000-000000000001',p_version,p_metadata);
  raise exception 'TEST_INSERT_SUCCEEDED'; -- Roll back each probe, even on the old migration.
end;
$$;
grant execute on function public.test_probe_reboot_upload(jsonb,text) to authenticated;
set local role authenticated;
select throws_ok($$select public.test_probe_reboot_upload('{"mimetype":"application/pdf","contentLength":128,"contentEncoding":"gzip"}','1')$$,'22023','MATCHING_REBOOT_INVALID_FILE','압축된 응답의 메타데이터는 업로드 사전 검사에서도 거부한다');
select throws_ok($$select public.test_probe_reboot_upload('{"mimetype":"application/pdf","contentLength":128}','1')$$,'P0001','TEST_INSERT_SUCCEEDED','Storage 권한 검사에는 실제 저장된 크기가 아직 없다');
reset role;
select throws_ok($$select public.test_probe_reboot_upload('{"mimetype":"application/pdf","size":128,"cacheControl":"public, max-age=3600"}')$$,'22023','MATCHING_REBOOT_INVALID_FILE','Storage 백엔드의 캐시 가능한 최종 업로드를 막는다');
select throws_ok($$select public.test_probe_reboot_upload('{"mimetype":"application/pdf","size":128,"cacheControl":"private, no-store","contentEncoding":"br"}')$$,'22023','MATCHING_REBOOT_INVALID_FILE','Storage 백엔드의 압축 최종 업로드를 막는다');
select throws_ok($$select public.test_probe_reboot_upload('{"mimetype":"image/svg+xml","size":128,"cacheControl":"private, no-store"}')$$,'22023','MATCHING_REBOOT_INVALID_FILE','SVG 메타데이터는 게시 여부와 무관하게 거부한다');
select throws_ok($$select public.test_probe_reboot_upload('{"mimetype":"application/pdf","size":0,"cacheControl":"private, no-store"}')$$,'22023','MATCHING_REBOOT_INVALID_FILE','실제 저장된 최종 파일이 비어 있으면 거부한다');
select throws_ok($$select public.test_probe_reboot_upload('{"mimetype":"application/pdf","contentLength":128}','1')$$,'22023','MATCHING_REBOOT_INVALID_FILE','Storage 백엔드가 사전 검사 모양의 메타데이터만으로 최종 저장할 수 없다');
set local role authenticated;
select lives_ok($$insert into storage.objects(bucket_id,name,owner_id,metadata) values ('reboot-attachments',current_setting('test.reboot_path'),auth.uid()::text,'{"mimetype":"application/pdf","size":128,"cacheControl":"private, no-store"}')$$,'작성자가 안전한 응답 메타데이터로 자신의 예약 경로에 업로드한다');
set local storage.operation = 'storage.object.get_authenticated';
select set_config('request.path','/object/reboot-attachments/'||current_setting('test.reboot_path')||'?download=',true);
select is((select count(*) from storage.objects where bucket_id='reboot-attachments'),0::bigint,'취소 전 임시 파일은 작성자에게도 읽기 경로를 제공하지 않는다');
set local request.jwt.claim.sub = '17210000-0000-4000-8000-000000000002';
select is((select count(*) from storage.objects where bucket_id='reboot-attachments'),0::bigint,'학교 인증을 받은 다른 계정도 임시 파일은 읽지 못한다');
set local storage.operation = 'storage.object.upload';
select throws_ok($$insert into storage.objects(bucket_id,name,owner_id) values ('reboot-attachments',current_setting('test.reboot_path'),auth.uid()::text)$$,'42501',null,'다른 작성자의 저장 경로에 쓸 수 없다');
select throws_ok($$select public.create_matching_opportunity('reboot','첨부 키 탈취','이전 작업에 새 방향을 제시합니다',array['기획'],p_reboot_prior_work=>'초안 작성',p_reboot_changes=>'일정과 역할을 조정',p_reboot_request_id=>'17210000-0000-4000-8000-000000000024',p_reboot_has_attachment=>true)$$,'P0001','MATCHING_REBOOT_ATTEMPT_UNAVAILABLE','다른 작성자 파일을 자기 게시물에 첨부할 수 없다');
select is(public.cancel_matching_reboot_attempt('17210000-0000-4000-8000-000000000024')->>'object_path',null,'다른 작성자의 업로드를 취소할 수 없다');
-- The following SQL statements mimic the Storage API's operation/transaction context for metadata fixtures only.
set local storage.operation = 'storage.object.delete_many';
set local storage.allow_delete_query = 'true';
with gone as (delete from storage.objects where bucket_id='reboot-attachments' returning id)
select is((select count(*) from gone),0::bigint,'다른 작성자는 임시 파일을 지울 수 없다');
set local request.jwt.claim.sub = '17210000-0000-4000-8000-000000000001';
reset role;
update storage.objects set metadata = jsonb_set(metadata,'{cacheControl}','"max-age=3600"') where name=current_setting('test.reboot_path');
set local role authenticated;
select throws_ok($test$do $$begin
  perform public.create_matching_opportunity('reboot','응답 캐시 거부','이전 작업에 새 방향을 제시합니다',array['기획'],p_reboot_prior_work=>'초안 작성',p_reboot_changes=>'일정과 역할을 조정',p_reboot_request_id=>'17210000-0000-4000-8000-000000000024',p_reboot_has_attachment=>true);
  raise exception 'TEST_PUBLISH_SUCCEEDED';
end;$$
$test$,'P0001','MATCHING_REBOOT_INVALID_FILE','등록 시점에 Storage 응답 메타데이터를 다시 검증한다');
reset role;
update storage.objects set metadata = jsonb_set(metadata,'{cacheControl}','"private, no-store"') where name=current_setting('test.reboot_path');
set local role authenticated;
select set_config('test.reboot_published',public.create_matching_opportunity('reboot','자료와 함께','이전 작업에 새 방향을 제시합니다',array['기획'],p_reboot_prior_work=>' 초안 작성 ',p_reboot_changes=>'일정과 역할을 조정',p_reboot_request_id=>'17210000-0000-4000-8000-000000000024',p_reboot_has_attachment=>true)::text,true);
select is(public.create_matching_opportunity('reboot','자료와 함께','이전 작업에 새 방향을 제시합니다',array['기획'],p_reboot_prior_work=>'초안 작성',p_reboot_changes=>'일정과 역할을 조정',p_reboot_request_id=>'17210000-0000-4000-8000-000000000024',p_reboot_has_attachment=>true),current_setting('test.reboot_published')::uuid,'같은 등록 요청은 글을 중복 생성하지 않는다');
select is(public.cancel_matching_reboot_attempt('17210000-0000-4000-8000-000000000024')->>'opportunity_id',current_setting('test.reboot_published'),'등록 응답을 잃어도 정리 전에 이미 게시되었음을 확인한다');
with gone as (delete from storage.objects where bucket_id='reboot-attachments' returning id)
select is((select count(*) from gone),0::bigint,'작성자도 이미 게시한 첨부 파일은 정리로 삭제할 수 없다');
set local request.jwt.claim.sub = '17210000-0000-4000-8000-000000000002';
set local storage.operation = 'storage.object.sign';
select is((select count(*) from storage.objects where bucket_id='reboot-attachments'),0::bigint,'로그인하지 않은 사람에게 전달할 서명 URL을 만들 수 없다');
set local storage.operation = 'storage.object.get_authenticated';
select set_config('request.path','/object/reboot-attachments/'||current_setting('test.reboot_path'),true);
select is((select count(*) from storage.objects where bucket_id='reboot-attachments'),0::bigint,'학교 인증 학생도 응답을 인라인 렌더링할 수 없다');
select set_config('request.path','/object/reboot-attachments/'||current_setting('test.reboot_path')||'?download=&download=',true);
select is((select count(*) from storage.objects where bucket_id='reboot-attachments'),0::bigint,'중복 다운로드 매개변수는 허용하지 않는다');
select set_config('request.path','/object/reboot-attachments/'||current_setting('test.reboot_path')||'?download=',true);
select is((select count(*) from storage.objects where bucket_id='reboot-attachments'),1::bigint,'학교 인증 학생은 게시된 모집글 첨부 파일을 읽을 수 있다');
select is((select concat_ws('|',reboot_prior_work,reboot_changes,reboot_attachment->>'filename',reboot_attachment->>'size') from public.list_matching_opportunities('reboot') where id=current_setting('test.reboot_published')::uuid),'초안 작성|일정과 역할을 조정|작업 내역.pdf|128','게시글은 입력과 읽을 수 있는 파일명을 반환한다');
set local request.jwt.claim.sub = '17210000-0000-4000-8000-000000000003';
select is((select count(*) from storage.objects where bucket_id='reboot-attachments'),0::bigint,'학교 미인증 계정은 게시 파일을 읽을 수 없다');
reset role;
set local role anon;
select is((select count(*) from storage.objects where bucket_id='reboot-attachments'),0::bigint,'비회원은 게시 파일을 읽을 수 없다');
reset role;
set local role authenticated;
set local request.jwt.claim.sub = '17210000-0000-4000-8000-000000000001';
select public.close_matching_opportunity(current_setting('test.reboot_published')::uuid);
set local request.jwt.claim.sub = '17210000-0000-4000-8000-000000000002';
select is((select count(*) from storage.objects where bucket_id='reboot-attachments'),0::bigint,'모집 마감 후에는 다른 학생에게 더 이상 다운로드를 허용하지 않는다');

set local request.jwt.claim.sub = '17210000-0000-4000-8000-000000000001';
select set_config('test.reboot_cancel_path',public.begin_matching_reboot('17210000-0000-4000-8000-000000000025','미완성 작업.png'),true);
set local storage.operation = 'storage.object.upload';
insert into storage.objects(bucket_id,name,owner_id,metadata)
values ('reboot-attachments',current_setting('test.reboot_cancel_path'),auth.uid()::text,'{"mimetype":"image/png","size":128,"cacheControl":"private, no-store"}');
select is(public.cancel_matching_reboot_attempt('17210000-0000-4000-8000-000000000025')->>'object_path',current_setting('test.reboot_cancel_path'),'작성자는 실패한 본인 업로드를 취소할 수 있다');
select is(public.list_matching_reboot_cleanup(),array[current_setting('test.reboot_cancel_path')],'미처 삭제하지 못한 파일은 작성자에게만 정리 대상으로 표시한다');
select throws_ok($$select public.create_matching_opportunity('reboot','취소된 시도','이전 작업에 새 방향을 제시합니다',array['기획'],p_reboot_prior_work=>'초안 작성',p_reboot_changes=>'일정과 역할을 조정',p_reboot_request_id=>'17210000-0000-4000-8000-000000000025',p_reboot_has_attachment=>true)$$,'P0001','MATCHING_REBOOT_ATTEMPT_UNAVAILABLE','늦게 도착한 등록 요청에 취소된 파일이 첨부되지 않는다');
set local storage.operation = 'storage.object.get_authenticated';
select set_config('request.path','/object/reboot-attachments/'||current_setting('test.reboot_cancel_path')||'?download=',true);
select is((select count(*) from storage.objects where name=current_setting('test.reboot_cancel_path')),0::bigint,'취소 후에도 다운로드가 아니라 삭제만 가능하다');
set local storage.operation = 'storage.object.delete_many';
with gone as (delete from storage.objects where name=current_setting('test.reboot_cancel_path') returning id)
select is((select count(*) from gone),1::bigint,'취소된 파일은 작성자가 정리할 수 있다');
reset role;
-- Storage performs the final metadata INSERT as its backend role after preflight.
select throws_ok($$insert into storage.objects(bucket_id,name,owner_id,metadata)
  values ('reboot-attachments',current_setting('test.reboot_cancel_path'),'17210000-0000-4000-8000-000000000001','{"mimetype":"image/png","size":128,"cacheControl":"private, no-store"}')$$,
  '42501','MATCHING_REBOOT_ATTEMPT_UNAVAILABLE','Storage 백엔드도 취소 뒤 늦게 도착한 업로드를 완료할 수 없다');

-- Create physical-object metadata plus current reservations. The owner must release
-- space by removing bytes, not just by cancelling or waiting for the hourly window.
set local role authenticated;
set local request.jwt.claim.sub = '17210000-0000-4000-8000-000000000002';
set local storage.operation = 'storage.object.upload';
select set_config('test.cancelled_pending_request',gen_random_uuid()::text,true);
select set_config('test.cancelled_pending_path',public.begin_matching_reboot(current_setting('test.cancelled_pending_request')::uuid,'취소.pdf'),true);
insert into storage.objects(bucket_id,name,owner_id,metadata) values ('reboot-attachments',current_setting('test.cancelled_pending_path'),auth.uid()::text,'{"mimetype":"application/pdf","size":128,"cacheControl":"private, no-store"}');
select public.cancel_matching_reboot_attempt(current_setting('test.cancelled_pending_request')::uuid);
reset role;
update private.matching_reboot_uploads set created_at=now()-interval '2 days' where object_path=current_setting('test.cancelled_pending_path');
set local role authenticated;
select public.begin_matching_reboot(gen_random_uuid(),'대기.pdf') from generate_series(1,4);
select throws_ok($$select public.begin_matching_reboot(gen_random_uuid(),'여섯 번째.pdf')$$,'P0001','MATCHING_REBOOT_PENDING_LIMIT','오래된 취소 파일도 실제로 삭제될 때까지 미게시 슬롯을 차지한다');
select lives_ok($$select public.begin_matching_reboot(gen_random_uuid())$$,'첨부 한도는 파일 없는 예약을 막지 않는다');
set local storage.operation = 'storage.object.delete_many';
delete from storage.objects where name=current_setting('test.cancelled_pending_path');
select lives_ok($$select public.begin_matching_reboot(gen_random_uuid(),'정리 뒤.pdf')$$,'Storage에서 취소 파일을 지우면 미게시 슬롯을 다시 사용할 수 있다');

reset role;
-- Closed listings still retain attachments. Admin-only seed bypasses the ordinary
-- publication rate limit to build the long-lived portion of the owner budget.
insert into private.matching_reboot_uploads(author_id,request_id,filename)
select '17210000-0000-4000-8000-000000000002',gen_random_uuid(),'보관.pdf' from generate_series(1,45);
insert into storage.objects(bucket_id,name,owner_id,metadata)
select 'reboot-attachments',d.object_path,d.author_id::text,'{"mimetype":"application/pdf","size":128,"cacheControl":"private, no-store"}'
from private.matching_reboot_uploads d where d.author_id='17210000-0000-4000-8000-000000000002' and d.filename='보관.pdf';
with archived as (
  insert into public.matching_opportunities(author_id,type,title,description,roles,closed_at,reboot_request_id,reboot_prior_work,reboot_changes)
  select d.author_id,'reboot','보관된 모집','설명은 열 자 이상이어야 합니다',array['기획'],now(),d.request_id,'이전 작업','역할 조정'
  from private.matching_reboot_uploads d where d.author_id='17210000-0000-4000-8000-000000000002' and d.filename='보관.pdf'
  returning id,reboot_request_id
)
update private.matching_reboot_uploads d set opportunity_id=a.id,mime='application/pdf',size=128,created_at=now()-interval '2 days'
from archived a where d.author_id='17210000-0000-4000-8000-000000000002' and d.request_id=a.reboot_request_id;
set local role authenticated;
select throws_ok($$select public.begin_matching_reboot(gen_random_uuid(),'누적 제한.pdf')$$,'P0001','MATCHING_REBOOT_STORAGE_LIMIT','마감한 게시글의 실제 파일도 계정의 전체 슬롯을 차지한다');
set local request.jwt.claim.sub = '17210000-0000-4000-8000-000000000001';
select lives_ok($$select public.begin_matching_reboot(gen_random_uuid(),'다른 계정.pdf')$$,'첨부 슬롯 한도는 계정 간에 영향을 주지 않는다');

select * from finish();
rollback;
