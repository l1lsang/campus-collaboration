# 프론트엔드 및 백엔드 구조

- Vite SPA: React Router `src/app/App.tsx`가 공개 화면과 세션·프로필 보호 경로를 분리한다. 브라우저 라우트 가드는 안내용이고 실제 권한의 근거가 아니다.
- Supabase Auth: 이메일 OTP 요청·검증과 세션 수립을 담당한다. `AuthProvider`가 세션 이벤트를 구독하고 사용자 간 변경 시 계정별 TanStack Query 캐시를 제거한다.
- 기능 폴더: `features/auth`, `profiles`, `universities`, `dashboard`, `projects`, `landing`. 폼은 React Hook Form과 Zod, 서버 상태는 TanStack Query로 다룬다.
- PostgreSQL: 공개 읽기와 개인 데이터는 RLS가 담당한다. 대학 확인, 프로젝트 생성, 초대 발급·수락·취소는 트랜잭션 단위 SQL RPC로 실행한다. 서버 키는 프론트엔드에 필요 없다.
- Supabase Storage/Realtime/Edge Functions는 Phase 1의 필수 경로에 사용하지 않는다. 첨부파일·실시간 협업·외부 AI 기능이 필요할 때 각각 적용한다.
- 브랜드 문자열: `src/lib/constants/brand.ts`. 문서 제목과 이메일 제목은 각 설정에서 관리한다. 팀플로그는 내부 협업 공간의 이름이다.
