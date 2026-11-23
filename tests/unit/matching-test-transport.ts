import type { AuthChangeEvent, Session } from '@supabase/supabase-js'
import { vi } from 'vitest'
import type { campusRpc } from '../../src/lib/supabase/rpc'

export const schoolAccount = 'signed-in-user'

export function matchingAuth() {
  let session: Pick<Session, 'access_token'> & { user: { id: string } }
  const listeners = new Set<(event: AuthChangeEvent, session: typeof session) => void>()
  const tokens = (id: string, access_token = `fixture:${id}`) => ({ user: { id }, access_token })
  session = tokens(schoolAccount)
  return {
    get id() {
      return session.user.id
    },
    set(id: string, token?: string, event?: AuthChangeEvent) {
      session = tokens(id, token)
      if (event) listeners.forEach((listener) => listener(event, session))
    },
    auth: {
      getSession: vi.fn(async () => ({ data: { session }, error: null })),
      onAuthStateChange(listener: (event: AuthChangeEvent, value: typeof session) => void) {
        listeners.add(listener)
        return { data: { subscription: { unsubscribe: () => listeners.delete(listener) } } }
      },
    },
  }
}

export function matchingTransport(
  rpc: typeof campusRpc,
  storage: {
    upload: (path: string, body: BodyInit | null | undefined, headers: Headers) => unknown
    remove: (paths: string[]) => unknown
  },
) {
  vi.stubEnv('VITE_SUPABASE_URL', 'http://localhost:54321')
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_unit_test')
  const request = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input))
    if (url.pathname.startsWith('/rest/v1/rpc/')) {
      try {
        return Response.json(
          await rpc(url.pathname.split('/').at(-1)!, JSON.parse(String(init?.body))),
        )
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error)
          return Response.json(error, { status: 400 })
        if (error instanceof Error && error.message.startsWith('MATCHING_'))
          return Response.json({ message: error.message, code: 'P0001' }, { status: 400 })
        throw error
      }
    }
    if (init?.method === 'POST') {
      const path = url.pathname.replace(/^\/storage\/v1\/object\/reboot-attachments\//, '')
      const result = await storage.upload(path, init.body, new Headers(init.headers))
      if ((result as { error?: unknown } | null)?.error) return Response.json({}, { status: 400 })
      return Response.json({ Id: 'object-id', Key: `reboot-attachments/${path}` })
    }
    if (init?.method === 'DELETE') {
      const result = await storage.remove(JSON.parse(String(init.body)).prefixes)
      if ((result as { error?: unknown } | null)?.error) return Response.json({}, { status: 400 })
      return Response.json([])
    }
    throw new Error(`unexpected request: ${url.pathname}`)
  })
  vi.stubGlobal('fetch', request)
  return request
}
