# 개발 환경

- Node 22.13 이상과 npm, Docker 호환 런타임이 필요하다. npm 락파일을 사용한다.
- `npm run dev:local`은 127.0.0.1:55321의 로컬 Supabase 공개 연결 값만 Vite에 주입한다. `npm run test:e2e`는 동일한 로컬 주소에서만 테스트하며 테스트용 서버 키를 Vite 공개 변수로 넘기지 않는다.
- 학교 계정 로그인은 Google OAuth만 사용한다. 로컬 DB 권한 테스트는 트랜잭션 안에서 가상의 검증된 Google 신원을 설정한다. 이 테스트는 실제 Google 로그인이나 운영 콜백을 대체하지 않는다.
- Supabase CLI 3.x는 `[local_smtp]`를 사용한다. CLI가 사용하는 Docker API와 컨테이너 레지스트리 접근이 필요하다. 로컬 개발 서비스를 외부 네트워크에 노출하지 않는다.
- SQL 타입 재생성: `npx supabase gen types --schema public > src/lib/supabase/database.types.ts` (스택 적용 이후 실행, 실패하면 이전 타입 파일 보존).
- 초기 이름과 도메인은 운영 등록 데이터와 구별한다. SQL 테스트는 롤백 트랜잭션에서 실행되며, 브라우저 테스트가 확인한 계정과 테스트 학교는 실행 종료 시 정리한다. Mailpit에는 로컬 메일이 남을 수 있다. `npx supabase db reset`은 로컬 데이터 삭제가 필요한 경우에만 사용한다. 운영 데이터가 있는 환경에서 실행하지 않는다.
