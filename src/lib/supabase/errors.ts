const messages: Record<string, string> = {
  SUPABASE_NOT_CONFIGURED: 'Supabase 연결 설정이 필요합니다.',
  SCHOOL_DOMAIN_NOT_REGISTERED:
    '현재 계정의 이메일 도메인은 학교 인증 대상으로 등록되지 않았습니다. 개인 이메일로 로그인은 계속할 수 있습니다.',
  SCHOOL_VERIFICATION_REVOKED: '학교 인증이 중지되었습니다. 운영자에게 문의해 주세요.',
  CONFIRMED_EMAIL_REQUIRED: '이메일 로그인 인증을 먼저 완료해 주세요.',
  VERIFIED_UNIVERSITY_REQUIRED: '학교 인증을 먼저 완료해 주세요.',
  PROFILE_REQUIRED: '프로필을 먼저 작성해 주세요.',
  PROJECT_RATE_LIMIT: '오늘은 더 이상 프로젝트를 만들 수 없습니다. 내일 다시 시도해 주세요.',
  INVITE_RATE_LIMIT: '이 프로젝트의 일일 초대 링크 생성 한도에 도달했습니다.',
  PROJECT_MEMBER_REQUIRED: '프로젝트 팀원만 팀원 목록을 볼 수 있습니다.',
  PROJECT_OWNER_REQUIRED: '프로젝트를 만든 팀장만 초대를 관리할 수 있습니다.',
  INVITE_UNAVAILABLE:
    '사용할 수 없는 초대입니다. 만료되었거나, 취소되었거나, 이미 사용되었을 수 있습니다.',
  ALREADY_PROJECT_MEMBER: '이미 이 프로젝트에 참여했습니다.',
  otp_expired: '인증 코드가 잘못되었거나 만료되었습니다. 코드를 확인하거나 다시 요청해 주세요.',
  over_email_send_rate_limit: '잠시 후 인증 코드를 다시 요청해 주세요.',
  over_request_rate_limit: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
  user_not_found: '해당 이메일로 로그인할 수 없습니다. 가입 여부를 확인해 주세요.',
  signup_disabled: '현재 회원가입을 진행할 수 없습니다.',
}

export function userError(error: unknown, fallback: string) {
  if (typeof error !== 'object' || error === null) return fallback
  for (const key of ['code', 'message'] as const) {
    if (key in error) {
      const value: unknown = (error as Record<string, unknown>)[key]
      if (typeof value === 'string' && Object.hasOwn(messages, value)) return messages[value]
    }
  }
  return fallback
}
