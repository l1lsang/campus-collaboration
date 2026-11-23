import type { Json } from './database.types'
import { getSupabase } from './client'

/** Boundary for module migrations not yet in the generated SDK snapshot. Validate writes in SQL. */
export async function campusRpc<T>(
  name: string,
  args?: Record<string, Json | undefined>,
): Promise<T> {
  const client = getSupabase()
  const response = await client.rpc(name as never, args as never)
  if (response.error) throw response.error
  return response.data as T
}
