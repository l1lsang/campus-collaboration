import type { Session } from '@supabase/supabase-js'
import type { QueryClient } from '@tanstack/react-query'

type Listener = (session: Session | null) => void
const listeners = new WeakMap<QueryClient, Set<Listener>>()

// Operations that outlive a route observe the provider's verification, not the raw SDK session.
export function observeVerifiedSession(cache: QueryClient, listener: Listener) {
  const subscribers = listeners.get(cache) ?? new Set<Listener>()
  listeners.set(cache, subscribers)
  subscribers.add(listener)
  return () => subscribers.delete(listener)
}

export function publishVerifiedSession(cache: QueryClient, session: Session | null) {
  for (const listener of listeners.get(cache) ?? []) listener(session)
}
