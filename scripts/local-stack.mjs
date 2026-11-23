import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const mode = process.argv[2]
if (!['dev', 'e2e'].includes(mode)) throw new Error('Usage: local-stack.mjs dev|e2e')
const state = spawnSync(
  process.execPath,
  [require.resolve('supabase/dist/supabase.js'), 'status', '-o', 'json'],
  { encoding: 'utf8' },
)
if (state.status !== 0) throw new Error('로컬 Supabase를 먼저 시작하세요: npx supabase start')
const local = JSON.parse(state.stdout)
if (local.API_URL !== 'http://127.0.0.1:55321' || !(local.PUBLISHABLE_KEY || local.ANON_KEY)) {
  throw new Error('이 프로젝트의 로컬 API 주소 또는 공개 키를 찾지 못했습니다.')
}
const env = {
  ...process.env,
  VITE_SUPABASE_URL: local.API_URL,
  VITE_SUPABASE_PUBLISHABLE_KEY: local.PUBLISHABLE_KEY || local.ANON_KEY,
}
if (mode === 'e2e') {
  if (!(local.SECRET_KEY || local.SERVICE_ROLE_KEY))
    throw new Error('로컬 테스트 준비용 서버 키가 없습니다.')
  env.E2E_SUPABASE_SERVICE_KEY = local.SECRET_KEY || local.SERVICE_ROLE_KEY
}
const args =
  mode === 'dev'
    ? [
        join(dirname(require.resolve('vite/package.json')), 'bin/vite.js'),
        '--host',
        '127.0.0.1',
        ...process.argv.slice(3),
      ]
    : [require.resolve('@playwright/test/cli'), 'test', ...process.argv.slice(3)]
const command = spawnSync(process.execPath, args, { env, stdio: 'inherit' })
if (command.error) throw command.error
process.exitCode = command.status ?? 1
