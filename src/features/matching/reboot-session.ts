import { createClient } from '@supabase/supabase-js'
import { getSupabase } from '../../lib/supabase/client'
import type { campusRpc } from '../../lib/supabase/rpc'

const rebootAccountChanged = 'MATCHING_REBOOT_ACCOUNT_CHANGED'
const bucket = 'reboot-attachments'

export type RebootAccount = {
  rpc: typeof campusRpc
  storage: ReturnType<ReturnType<typeof getSupabase>['storage']['from']>
  requireActive: () => void
  verifySession: () => Promise<void>
}

export async function withRebootAccount<T>(
  userId: string,
  work: (account: RebootAccount) => Promise<T>,
) {
  const { auth } = getSupabase()
  const controller = new AbortController()
  const requireActive = () => {
    if (controller.signal.aborted) throw new Error(rebootAccountChanged)
  }
  const {
    data: { subscription },
  } = auth.onAuthStateChange((_event, session) => {
    if (session?.user.id !== userId) controller.abort()
  })

  async function accessToken() {
    requireActive()
    const {
      data: { session },
      error,
    } = await auth.getSession()
    requireActive()
    if (error) throw error
    if (session?.user.id !== userId || !session.access_token) {
      controller.abort()
      throw new Error(rebootAccountChanged)
    }
    return session.access_token
  }

  try {
    await accessToken()
    // getSupabase() above validates the same URL and public key. Keep the SDK's
    // RPC and Storage transports, but authenticate this workflow at dispatch.
    const client = createClient(
      import.meta.env.VITE_SUPABASE_URL.trim(),
      import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY.trim(),
      {
        accessToken: async () => null, // No second Auth client or session persistence.
        global: {
          fetch: async (input, init) => {
            const token = await accessToken()
            requireActive()
            const headers = new Headers(init?.headers)
            headers.set('Authorization', `Bearer ${token}`)
            const signal = init?.signal
              ? AbortSignal.any([controller.signal, init.signal])
              : controller.signal
            return fetch(input, { ...init, headers, signal })
          },
        },
      },
    )
    const rpc: typeof campusRpc = async <T>(
      name: string,
      args?: Parameters<typeof campusRpc>[1],
    ) => {
      const response = await client.rpc(name, args)
      requireActive()
      if (response.error) throw response.error
      return response.data as T
    }
    return await work({
      rpc,
      storage: client.storage.from(bucket),
      requireActive,
      verifySession: async () => {
        await accessToken()
      },
    })
  } catch (error) {
    requireActive()
    throw error
  } finally {
    subscription.unsubscribe()
  }
}
