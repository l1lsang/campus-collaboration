# collab.

대학과 전공의 경계를 넘어 프로젝트를 만들고 팀을 구성하는 독립 플랫폼입니다. 초기 이용 대상은 성신여자대학교·덕성여자대학교·한성대학교 학생이며, 대학 공식 서비스나 제휴 프로그램이 아닙니다. **팀플로그**는 플랫폼 내부 프로젝트 공간의 이름입니다.

공개 프로젝트와 공개 모집글은 로그인 없이 볼 수 있습니다. 프로젝트 생성·팀 합류 같은 참여 기능에는 허용된 대학의 Google Workspace 계정이 필요합니다. 학교 계정 보유 여부를 확인하며, 재학생 인증은 별도로 하지 않습니다.

## 로컬 실행

Node.js `22.13+`, npm, 실행 중인 Docker가 필요합니다. 프로젝트 폴더에서 실행하세요.

```bash
npm ci
docker network create -o com.docker.network.bridge.host_binding_ipv4=127.0.0.1 campus-collaboration-local
npx supabase start --network-id campus-collaboration-local -x realtime,imgproxy,edge-runtime,logflare,vector,studio,supavisor
npm run dev:local
```

네트워크 생성 명령은 최초 한 번만 실행합니다. `docker ps`의 포트 바인딩을 확인하고, `0.0.0.0` 또는 `[::]`에 게시되면 공유·공용 네트워크에서는 실행하지 마세요. 앱은 `http://127.0.0.1:5173`, 로컬 메일함은 `http://127.0.0.1:55324`에서 엽니다. 초기 마이그레이션과 학교 목록은 시작할 때 자동 반영됩니다. **실제 학교 도메인은 초기 등록하지 않습니다.** 로컬 자동 테스트에서만 가상의 두 학교 도메인을 사용합니다. 필요 없는 동안에는 `npx supabase stop`으로 프로젝트 스택을 중지하세요.

## 환경 변수

로컬 스택을 쓸 때 `npm run dev:local`은 설정 파일 없이 실행할 수 있습니다. 별도 Supabase 프로젝트에 연결할 때는 `.env.example`을 `.env.local`로 복사하고 아래 값을 채운 뒤 `npm run dev`를 실행하세요.

| 변수                            | 값                                                |
| ------------------------------- | ------------------------------------------------- |
| `VITE_SUPABASE_URL`             | Supabase 프로젝트 URL                             |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | 공개 `sb_publishable_…` 키 또는 레거시 `anon` JWT |

`secret`·`service_role` 키는 프론트엔드, `VITE_` 변수, 배포 번들에 넣지 마세요. 연결하지 않으면 공개 랜딩은 볼 수 있고 데이터가 필요한 화면은 설정 안내를 표시합니다.

## 검증

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run test:db -- --network-id campus-collaboration-local
npx playwright install chromium
npm run test:e2e                # 로컬 Supabase 필요
```

## 운영 연결 및 배포

메인 주소는 `https://collab-blush-kappa.vercel.app/`입니다. [Vercel 및 Supabase hsp 운영 설정](docs/PRODUCTION.md)에서 환경 변수, Google 콜백, 학교 도메인 확인 및 배포 검증 절차를 확인하세요.

Vite · React · TypeScript · Tailwind CSS · shadcn/ui 패턴(Radix + CVA) · Lucide · React Router · TanStack Query · React Hook Form · Zod · Supabase Auth/PostgreSQL.

[구조](docs/ARCHITECTURE.md) · [DB](docs/DATABASE.md) · [보안](docs/SECURITY.md) · [기능 상태](docs/FEATURES.md) · [개발](docs/DEVELOPMENT.md) · [로드맵](docs/ROADMAP.md)
