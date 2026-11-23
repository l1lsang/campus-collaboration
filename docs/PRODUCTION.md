# 운영 환경: Vercel `collab` + Supabase `hsp`

| 설정                                          | 값                                                                         |
| --------------------------------------------- | -------------------------------------------------------------------------- |
| 메인 웹 주소                                  | `https://collab-blush-kappa.vercel.app/`                                   |
| Supabase 프로젝트                             | `hsp` (`dvtzipqmpuvelonxhpwo`, Production)                                 |
| Vercel `VITE_SUPABASE_URL`                    | `https://dvtzipqmpuvelonxhpwo.supabase.co`                                 |
| Vercel `VITE_SUPABASE_PUBLISHABLE_KEY`        | `hsp` Settings → API Keys의 공개용 키                                      |
| Supabase Auth Site URL                        | `https://collab-blush-kappa.vercel.app`                                    |
| Supabase Auth Redirect URLs                   | `https://collab-blush-kappa.vercel.app/auth/callback` (정확한 경로만 허용) |
| Google OAuth Web client의 승인된 리디렉션 URI | `https://dvtzipqmpuvelonxhpwo.supabase.co/auth/v1/callback`                |

## Google 로그인 준비

1. Google Cloud의 OAuth Web client를 사용한다. 여러 대학의 서로 다른 Workspace 조직이 들어오므로 단일 조직 내부용 앱으로 구성하지 않는다. Google 테스트 모드라면 허용된 테스트 계정으로 먼저 확인한다.
2. Supabase의 Authentication → Sign In / Providers에서 OAuth 클라이언트 정보를 **Google**에만 입력한다. 비밀번호 및 OAuth client secret을 Vercel, Git, 채팅에 넣지 않는다. 운영 전환 시 Email, Anonymous 및 사용하지 않는 공급자와 수동 공급자 연결을 비활성화한다.
3. Supabase Authentication → URL Configuration에 Site URL과 Redirect URL을 정확히 등록한다. Vercel Production 환경변수에 공개 연결 값만 등록한다. 로컬 Supabase 설정 파일을 운영에 통째로 덮어쓰지 않는다.
4. 학교 Google 계정을 가지고 있는 사람이 대상이며 재학생 여부를 따로 검증하지 않는다. 후보 이메일 도메인은 학교 공지에서 확인해도 토큰의 Workspace 호스트(`hd`) 값과 같다고 단정할 수 없다. 한성대 `hansung.ac.kr`, 덕성여대 `duksung.ac.kr`, 성신여대 `sungshin.ac.kr`을 후보로 실제 조직 계정에서 검증한다. 확인하지 않은 Workspace 도메인은 등록하지 않는다. 일반 Gmail, 승인되지 않은 Workspace, 이전 이메일 세션은 참여가 차단돼야 한다.

## 변경 적용과 검증

- 로컬 DB·웹 검증과 승인된 `dev` 통합 후 운영 적용한다. `npx supabase migration list --remote=dvtzipqmpuvelonxhpwo`와 `npx supabase db push --remote=dvtzipqmpuvelonxhpwo --dry-run --skip-vault`로 대상과 대기 목록을 점검한다. 운영에 개발용 시드를 넣거나 DB를 초기화하지 않는다.
- 적용한 마이그레이션 이력을 다시 읽어 DB와 운영 프런트엔드의 버전을 맞춘다. 공개 탐색, 직접 연 `/auth/callback`, 학교 로그인/개인 Gmail 차단, 비공개 프로젝트 팀 권한을 각각 확인한다. Google OAuth가 비활성화돼 있으면 로그인 완료로 보고하지 않는다.

공식 문서: [Supabase의 Google OAuth 설정](https://supabase.com/docs/guides/auth/social-login/auth-google), [Supabase 로그인 리디렉션](https://supabase.com/docs/guides/auth/redirect-urls), [Google OIDC의 hosted domain](https://developers.google.com/identity/openid-connect/openid-connect).
