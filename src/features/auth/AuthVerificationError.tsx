import { Notice } from '../../components/common/states'
import { useAuth } from './auth-provider'

export function AuthVerificationError() {
  const { retryVerification } = useAuth()
  return (
    <Notice kind="error">
      학교 인증 상태를 불러오지 못했습니다.{' '}
      <button className="text-link" onClick={retryVerification}>
        다시 시도
      </button>
    </Notice>
  )
}
