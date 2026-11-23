import { expect, test } from '@playwright/test'

const localApi = 'http://127.0.0.1:55321'
const inviteToken = 'a'.repeat(64)
const invitePath = `/invite#${inviteToken}`

test('비회원은 실제 로컬 Supabase에서 공개 프로젝트를 조회한다', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('학교는 달라도')
  const publicProjects = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return (
      url.origin === localApi &&
      url.pathname === '/rest/v1/projects' &&
      url.searchParams.get('visibility') === 'eq.public'
    )
  })
  await page.getByRole('link', { name: '프로젝트 둘러보기' }).first().click()
  const response = await publicProjects
  expect(response.ok()).toBe(true)
  expect(Array.isArray(await response.json())).toBe(true)
  await page.getByLabel('키워드').fill(`검색 결과 없는 키워드 ${crypto.randomUUID()}`)
  await expect(page.getByText('조건에 맞는 프로젝트가 없어요.')).toBeVisible()
})

test('보호 경로는 학교 Google 로그인으로 이동하고 가입에도 이메일 인증 폼이 없다', async ({
  page,
}) => {
  await page.goto('/dashboard')
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('heading', { name: '로그인' })).toBeVisible()
  await expect(page.getByRole('button', { name: '학교 Google 계정으로 계속하기' })).toBeVisible()
  await expect(page.getByLabel('이메일 주소')).toHaveCount(0)
  await page.getByRole('main').getByRole('link', { name: '회원가입' }).click()
  await expect(page.getByRole('heading', { name: '회원가입' })).toBeVisible()
  await expect(page.getByRole('button', { name: '학교 Google 계정으로 계속하기' })).toBeVisible()
  await expect(page.getByRole('button', { name: '인증 코드 받기' })).toHaveCount(0)
})

test('초대 프래그먼트는 PKCE 요청을 시작한 뒤 취소하고 재시도해도 외부 URL에 실리지 않는다', async ({
  page,
  baseURL,
}) => {
  // Stop at the outbound boundary. The real browser SDK creates the PKCE request;
  // no Google request, account, or session is involved in this test.
  const authorize = (url: URL) => url.origin === localApi && url.pathname === '/auth/v1/authorize'
  await page.route(authorize, (route) => route.fulfill({ status: 200, body: 'OAuth boundary' }))
  const assertAuthorize = async () => {
    const authorization = page.waitForRequest((request) => authorize(new URL(request.url())))
    await page.getByRole('button', { name: '학교 Google 계정으로 계속하기' }).click()
    const url = new URL((await authorization).url())
    expect(url.searchParams.get('provider')).toBe('google')
    expect(url.searchParams.get('code_challenge_method')).toBe('s256')
    expect(url.searchParams.get('code_challenge')).toBeTruthy()
    const callback = new URL(url.searchParams.get('redirect_to') ?? '')
    expect(callback.origin).toBe(baseURL)
    expect(callback.pathname).toBe('/auth/callback')
    expect(callback.hash).toBe('')
    expect(url.href).not.toContain(inviteToken)
  }

  await page.goto(invitePath)
  await page.getByRole('link', { name: '본문 바로가기' }).focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(new URL(invitePath, baseURL).href)
  await expect(page.getByRole('button', { name: '프로젝트 참여' })).toHaveCount(0)
  await page.getByRole('link', { name: '학교 Google 계정으로 로그인' }).click()
  await assertAuthorize()
  await page.goto('/auth/callback?error=access_denied')
  await expect(page.getByRole('alert')).toContainText(
    'Google 로그인이 취소되었거나 거부되었습니다.',
  )
  await page.getByRole('link', { name: '로그인 다시 시작' }).click()
  await assertAuthorize()
})

test('PKCE 코드가 없는 콜백은 실패 안내와 재시도 링크를 표시한다', async ({ page }) => {
  await page.goto('/auth/callback')
  await expect(page.getByRole('alert')).toContainText('Google 로그인을 완료하지 못했습니다.')
  await expect(page.getByRole('link', { name: '로그인 다시 시작' })).toHaveAttribute(
    'href',
    '/login',
  )
})

test.skip('외부 Google Workspace OAuth 왕복은 실제 학교 계정이 필요하다', () => {})
