const projectPath =
  /^\/projects\/(?:new|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}(?:\/(?:members|team|reports))?)$/
const appReturnPaths = new Set([
  '/dashboard',
  '/onboarding',
  '/settings',
  '/opportunities',
  '/opportunities/ideas',
  '/opportunities/reboots',
  '/opportunities/contests',
  '/opportunities/new',
  '/opportunities/mine',
  '/opportunities/requests',
  '/research',
  '/research/new',
  '/research/mine',
  '/research/credits',
])
export const isInviteToken = (value: string) => /^[a-f0-9]{64}$/.test(value) && value.length === 64

export function getInviteToken(hash: string): string | null {
  const token = hash.startsWith('#') ? hash.slice(1) : ''
  return isInviteToken(token) ? token : null
}

export function authReturnPath(path: unknown): string {
  if (typeof path !== 'string' || path !== path.trim()) return '/dashboard'
  const normalizedPath = path.endsWith('/') ? path.slice(0, -1) : path
  if (appReturnPaths.has(normalizedPath) || projectPath.test(normalizedPath)) return normalizedPath
  if (path.startsWith('/invite#') && getInviteToken(path.slice('/invite'.length))) return path
  return '/dashboard'
}

const oauthReturnKey = 'campus:oauth-return'

// Keep single-use invitation fragments out of the OAuth redirect URL.
export function rememberAuthReturnPath(path: unknown) {
  sessionStorage.setItem(oauthReturnKey, authReturnPath(path))
}

export function readAuthReturnPath() {
  try {
    return authReturnPath(sessionStorage.getItem(oauthReturnKey))
  } catch {
    return '/dashboard'
  }
}

export function clearAuthReturnPath() {
  try {
    sessionStorage.removeItem(oauthReturnKey)
  } catch {
    // Storage may be blocked by the browser.
  }
}
