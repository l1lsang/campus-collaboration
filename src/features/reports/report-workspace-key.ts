import { useAuth } from '../auth/auth-provider'
import { workspaceKey } from './reports-api'

export function useReportWorkspaceKey(userId: string, ref: Parameters<typeof workspaceKey>[1]) {
  const { verificationVersion } = useAuth()
  const key = workspaceKey(userId, ref)
  // A prior grant or in-flight response cannot qualify a newly verified token.
  return verificationVersion == null ? key : ([...key, verificationVersion] as const)
}
