import { createClient } from '@supabase/supabase-js'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  confirmReboot,
  downloadRebootAttachment,
  hasPendingReboot,
  publishReboot,
} from '../../src/features/matching/reboot-attachments'
import { campusRpc } from '../../src/lib/supabase/rpc'
import { matchingAuth, matchingTransport, schoolAccount } from './matching-test-transport'

const storage = vi.hoisted(() => ({ upload: vi.fn(), remove: vi.fn(), download: vi.fn() }))
const account = matchingAuth()
vi.mock('../../src/lib/supabase/client', () => ({
  getSupabase: () => ({ auth: account.auth, storage: { from: () => storage } }),
}))
vi.mock('../../src/lib/supabase/rpc', () => ({ campusRpc: vi.fn() }))
const rpc = vi.mocked(campusRpc)
const pdf = new File(['%PDF-1.7'], '작업.pdf', { type: 'application/pdf' })

beforeEach(() => {
  vi.clearAllMocks()
  rpc.mockReset()
  storage.upload.mockReset()
  storage.remove.mockReset()
  storage.download.mockReset()
  account.set(schoolAccount)
  sessionStorage.clear()
  matchingTransport(rpc, storage)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it.each([
  new File(['invalid'], '작업.html', { type: 'text/html' }),
  new File(['invalid'], '작업.pdf', { type: 'image/jpeg' }),
  new File(['<html>파일 아님</html>'], '작업.pdf', { type: 'application/pdf' }),
  new File([], '빈 파일.png', { type: 'image/png' }),
  new File([new Uint8Array(10 * 1024 * 1024 + 1)], '큰 파일.jpg', { type: 'image/jpeg' }),
])('허용되지 않는 파일은 예약하거나 업로드하지 않는다: $name', async (file) => {
  await expect(publishReboot(new FormData(), file, schoolAccount)).rejects.toThrow(
    'MATCHING_REBOOT_INVALID_FILE',
  )
  expect(rpc).not.toHaveBeenCalled()
  expect(storage.upload).not.toHaveBeenCalled()
})

it('DB가 예약 한도를 확정해서 거절하면 취소 요청으로 오류를 가리지 않는다', async () => {
  const limit = { code: 'P0001', message: 'MATCHING_REBOOT_UPLOAD_LIMIT' }
  rpc.mockImplementation(async (name) => {
    if (name === 'list_matching_reboot_cleanup') return []
    if (name === 'begin_matching_reboot') throw limit
    throw new Error('unexpected cancellation')
  })
  await expect(publishReboot(new FormData(), pdf, schoolAccount)).rejects.toEqual(limit)
  expect(hasPendingReboot(schoolAccount)).toBe(false)
  expect(rpc.mock.calls.map(([name]) => name)).toEqual([
    'list_matching_reboot_cleanup',
    'begin_matching_reboot',
  ])
})

it('등록 응답을 받지 못해도 DB에서 찾은 모집글을 반환하고 첨부는 지우지 않는다', async () => {
  rpc.mockImplementation(async (name) => {
    switch (name) {
      case 'list_matching_reboot_cleanup':
        return []
      case 'begin_matching_reboot':
        return 'opaque-path'
      case 'create_matching_opportunity':
        throw new Error('connection lost')
      case 'cancel_matching_reboot_attempt':
        return { opportunity_id: 'published-id' }
      default:
        throw new Error(`unexpected rpc: ${name}`)
    }
  })
  storage.upload.mockResolvedValue({ error: null })
  await expect(publishReboot(new FormData(), pdf, schoolAccount)).resolves.toBe('published-id')
  const reserve = rpc.mock.calls.find(([name]) => name === 'begin_matching_reboot')?.[1]
  expect(rpc).toHaveBeenCalledWith('cancel_matching_reboot_attempt', {
    p_request_id: reserve?.p_request_id,
  })
  expect(rpc).toHaveBeenCalledWith(
    'create_matching_opportunity',
    expect.objectContaining({
      p_reboot_request_id: reserve?.p_request_id,
      p_reboot_has_attachment: true,
    }),
  )
  expect(hasPendingReboot(schoolAccount)).toBe(false)
  expect(storage.remove).not.toHaveBeenCalled()
})

it('연결이 복구되면 이전 요청부터 확인하고 이미 게시된 글을 중복 등록하지 않는다', async () => {
  rpc
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce(null)
    .mockRejectedValueOnce(new Error('offline'))
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce({ opportunity_id: 'published-id' })
  await expect(publishReboot(new FormData(), null, schoolAccount)).rejects.toThrow(
    'MATCHING_REBOOT_CLEANUP_FAILED',
  )
  const requestId = rpc.mock.calls[1][1]?.p_request_id
  expect(requestId).toEqual(expect.any(String))
  expect(hasPendingReboot(schoolAccount)).toBe(true)
  await expect(confirmReboot(schoolAccount)).resolves.toBe('published-id')
  expect(rpc.mock.calls.slice(3)).toEqual([
    ['cancel_matching_reboot_attempt', { p_request_id: requestId }],
    ['cancel_matching_reboot_attempt', { p_request_id: requestId }],
  ])
  expect(storage.upload).not.toHaveBeenCalled()
})

it('파일 검사 중 계정이 바뀌면 예약 요청과 파일 전송을 시작하지 않는다', async () => {
  const reading = Promise.withResolvers<void>()
  const bytes = Promise.withResolvers<ArrayBuffer>()
  const file = new File(['%PDF-1.7'], '작업.pdf', { type: 'application/pdf' })
  vi.spyOn(file, 'arrayBuffer').mockImplementation(() => {
    reading.resolve()
    return bytes.promise
  })
  const outcome = expect(publishReboot(new FormData(), file, schoolAccount)).rejects.toThrow(
    'MATCHING_REBOOT_ACCOUNT_CHANGED',
  )
  await reading.promise
  account.set('different-account', undefined, 'SIGNED_IN')
  bytes.resolve(await pdf.arrayBuffer())
  await outcome
  expect(fetch).not.toHaveBeenCalled()
  expect(sessionStorage.length).toBe(0)
})

it('인증 이벤트보다 세션이 먼저 바뀌어도 업로드 뒤 다른 계정에 본문을 보내지 않는다', async () => {
  const transport = matchingTransport(rpc, storage)
  rpc.mockResolvedValueOnce([]).mockResolvedValueOnce('opaque-path')
  storage.upload.mockImplementation(async () => {
    account.set('different-account')
    return { error: null }
  })
  const form = new FormData()
  form.set('title', '제출을 시작한 계정의 내용')
  await expect(publishReboot(form, pdf, schoolAccount)).rejects.toThrow(
    'MATCHING_REBOOT_ACCOUNT_CHANGED',
  )
  expect(rpc.mock.calls.map(([name]) => name)).toEqual([
    'list_matching_reboot_cleanup',
    'begin_matching_reboot',
  ])
  expect(storage.upload).toHaveBeenCalledTimes(1)
  expect(
    transport.mock.calls.map(([, init]) => new Headers(init?.headers).get('Authorization')),
  ).toEqual(Array(3).fill(`Bearer fixture:${schoolAccount}`))
  expect(hasPendingReboot(schoolAccount)).toBe(true)
  expect(hasPendingReboot('different-account')).toBe(false)
})

it('같은 계정 토큰 갱신 후에도 업로드와 등록을 계속한다', async () => {
  const transport = matchingTransport(rpc, storage)
  rpc.mockImplementation(async (name) => {
    if (name === 'list_matching_reboot_cleanup') return []
    if (name === 'begin_matching_reboot') {
      account.set(schoolAccount, 'refreshed-fixture', 'TOKEN_REFRESHED')
      return 'opaque-path'
    }
    if (name === 'create_matching_opportunity') return 'listing'
    throw new Error(`unexpected rpc: ${name}`)
  })
  storage.upload.mockResolvedValue({ error: null })
  await expect(publishReboot(new FormData(), pdf, schoolAccount)).resolves.toBe('listing')
  expect(
    transport.mock.calls.map(([, init]) => new Headers(init?.headers).get('Authorization')),
  ).toEqual([
    `Bearer fixture:${schoolAccount}`,
    `Bearer fixture:${schoolAccount}`,
    'Bearer refreshed-fixture',
    'Bearer refreshed-fixture',
  ])
  expect(hasPendingReboot(schoolAccount)).toBe(false)
})

it('등록 결과 확인 중 계정을 바꿨다가 돌아와도 기존 확인과 파일 삭제를 중단한다', async () => {
  const transport = matchingTransport(rpc, storage)
  rpc
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce('opaque-path')
    .mockRejectedValueOnce(new Error('lost reply'))
    .mockImplementationOnce(async () => {
      account.set('different-account', undefined, 'SIGNED_IN')
      account.set(schoolAccount, undefined, 'SIGNED_IN')
      return { object_path: 'opaque-path' }
    })
  storage.upload.mockResolvedValue({ error: null })
  await expect(publishReboot(new FormData(), pdf, schoolAccount)).rejects.toThrow(
    'MATCHING_REBOOT_ACCOUNT_CHANGED',
  )
  expect(transport.mock.calls.at(-1)?.[1]?.signal?.aborted).toBe(true)
  expect(storage.remove).not.toHaveBeenCalled()
  expect(hasPendingReboot(schoolAccount)).toBe(true)
})

it('인증 이벤트가 늦으면 다른 계정으로 바뀐 뒤 받은 등록 확인을 확정하지 않는다', async () => {
  rpc
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce(null)
    .mockRejectedValueOnce(new Error('lost reply'))
    .mockImplementationOnce(async () => {
      account.set('different-account')
      return { opportunity_id: 'published-id' }
    })
  await expect(publishReboot(new FormData(), null, schoolAccount)).rejects.toThrow(
    'MATCHING_REBOOT_ACCOUNT_CHANGED',
  )
  expect(hasPendingReboot(schoolAccount)).toBe(true)
})

it('서버가 등록 확인 결과를 빠뜨리면 대기 ID를 지우지 않는다', async () => {
  rpc
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce(null)
    .mockRejectedValueOnce(new Error('lost reply'))
    .mockResolvedValueOnce({})
  await expect(publishReboot(new FormData(), null, schoolAccount)).rejects.toThrow(
    'MATCHING_REBOOT_CLEANUP_FAILED',
  )
  expect(hasPendingReboot(schoolAccount)).toBe(true)
})

it('등록 ID를 브라우저에 저장할 수 없으면 예약하지 않는다', async () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
    throw new DOMException('storage disabled', 'SecurityError')
  })
  rpc.mockResolvedValueOnce([])
  await expect(publishReboot(new FormData(), pdf, schoolAccount)).rejects.toThrow(
    'MATCHING_REBOOT_BROWSER_STORAGE_UNAVAILABLE',
  )
  expect(rpc.mock.calls.map(([name]) => name)).toEqual(['list_matching_reboot_cleanup'])
  expect(storage.upload).not.toHaveBeenCalled()
})

it('취소가 확인되어도 첨부 정리에 실패하면 ID를 유지하고 정리 성공 후 해제한다', async () => {
  rpc
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce('opaque-path')
    .mockRejectedValueOnce(new Error('lost reply'))
    .mockResolvedValue({ object_path: 'opaque-path' })
  storage.upload.mockResolvedValue({ error: null })
  storage.remove
    .mockRejectedValueOnce(new Error('storage offline'))
    .mockResolvedValueOnce({ error: null })
  await expect(publishReboot(new FormData(), pdf, schoolAccount)).rejects.toThrow(
    'MATCHING_REBOOT_CLEANUP_FAILED',
  )
  const requestId = rpc.mock.calls[1][1]?.p_request_id
  expect(requestId).toEqual(expect.any(String))
  expect(Object.values(sessionStorage)).toEqual([requestId])
  await expect(confirmReboot(schoolAccount)).resolves.toBeNull()
  expect(storage.remove.mock.calls).toEqual([[['opaque-path']], [['opaque-path']]])
  expect(rpc.mock.calls.slice(3)).toEqual([
    ['cancel_matching_reboot_attempt', { p_request_id: requestId }],
    ['cancel_matching_reboot_attempt', { p_request_id: requestId }],
  ])
  expect(sessionStorage.length).toBe(0)
})

it('아직 처리 중인 같은 탭의 요청은 새 화면에서 취소하지 않는다', async () => {
  const started = Promise.withResolvers<void>()
  const result = Promise.withResolvers<null>()
  rpc
    .mockResolvedValueOnce([])
    .mockImplementationOnce(async () => {
      started.resolve()
      return result.promise
    })
    .mockResolvedValueOnce('listing')
  const active = publishReboot(new FormData(), null, schoolAccount)
  await started.promise
  await expect(confirmReboot(schoolAccount)).rejects.toThrow('MATCHING_REBOOT_ATTEMPT_ACTIVE')
  result.resolve(null)
  await expect(active).resolves.toBe('listing')
  expect(rpc.mock.calls.map(([name]) => name)).toEqual([
    'list_matching_reboot_cleanup',
    'begin_matching_reboot',
    'create_matching_opportunity',
  ])
  expect(sessionStorage.length).toBe(0)
})

it('브라우저가 MIME을 알려주지 않으면 허용한 확장자의 MIME으로 업로드한다', async () => {
  rpc
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce('opaque-path')
    .mockResolvedValueOnce('listing')
  storage.upload.mockResolvedValue({ error: null })
  await publishReboot(new FormData(), new File(['%PDF-1.7'], '작업.pdf'), schoolAccount)
  expect(storage.upload).toHaveBeenCalledWith(
    'opaque-path',
    expect.any(ArrayBuffer),
    expect.any(Headers),
  )
  const headers = storage.upload.mock.calls[0][2] as Headers
  expect(headers.get('content-type')).toBe('application/pdf')
  expect(headers.get('cache-control')).toBe('private, no-store')
})

it('인증 다운로드를 캐시하지 않고 읽을 수 있는 이름으로 브라우저에 저장한다', async () => {
  vi.useFakeTimers()
  const createObjectURL = vi.fn(() => 'blob:local-download')
  const revokeObjectURL = vi.fn()
  class TestURL extends URL {
    static createObjectURL = createObjectURL
    static revokeObjectURL = revokeObjectURL
  }
  vi.stubGlobal('URL', TestURL)
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    expect(this.href).toBe('blob:local-download')
    expect(this.download).toBe('작업_보고.pdf')
    expect(this.target).toBe('')
  })
  storage.download.mockResolvedValue({ data: pdf, error: null })
  await downloadRebootAttachment({
    path: 'opaque-path',
    filename: '작업/보고.pdf',
    mime: 'application/pdf',
    size: pdf.size,
  })
  expect(storage.download).toHaveBeenCalledWith('opaque-path?download=', {}, { cache: 'no-store' })
  expect(createObjectURL).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'application/octet-stream' }),
  )
  expect(click).toHaveBeenCalledTimes(1)
  expect(document.querySelector('[download]')).toBeNull()
  vi.runOnlyPendingTimers()
  expect(revokeObjectURL).toHaveBeenCalledWith('blob:local-download')
})

it('서버가 허용한 MIME을 보내더라도 일치하지 않는 실제 바이트는 저장하지 않는다', async () => {
  const forged = new Blob(['<html>파일 아님</html>'], { type: 'application/pdf' })
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click')
  storage.download.mockResolvedValue({ data: forged, error: null })
  await expect(
    downloadRebootAttachment({
      path: 'opaque-path',
      filename: '작업.pdf',
      mime: 'application/pdf',
      size: forged.size,
    }),
  ).rejects.toThrow('MATCHING_REBOOT_INVALID_FILE')
  expect(click).not.toHaveBeenCalled()
})

it('고정된 SDK가 원시 업로드 헤더와 다운로드 전용 쿼리를 HTTP에 전달한다', async () => {
  const fetchDownload = vi.fn<typeof fetch>(
    async () => new Response('%PDF-1.7', { headers: { 'Content-Type': 'application/pdf' } }),
  )
  const sdk = createClient('http://localhost:54321', 'sb_publishable_unit_test', {
    accessToken: async () => null,
    global: { fetch: fetchDownload },
  }).storage.from('reboot-attachments')
  const fetchUpload = matchingTransport(rpc, storage)
  storage.download.mockImplementation(sdk.download.bind(sdk))
  rpc
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce('opaque-path')
    .mockResolvedValueOnce('listing')
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)

  await publishReboot(new FormData(), pdf, schoolAccount)
  await downloadRebootAttachment({
    path: 'opaque-path',
    filename: pdf.name,
    mime: pdf.type,
    size: pdf.size,
  })

  const [uploadUrl, upload] = fetchUpload.mock.calls[2]
  const [downloadUrl, download] = fetchDownload.mock.calls[0]
  expect(String(uploadUrl)).toBe(
    'http://localhost:54321/storage/v1/object/reboot-attachments/opaque-path',
  )
  const headers = new Headers(upload?.headers)
  expect(headers.get('cache-control')).toBe('private, no-store')
  expect(headers.get('content-type')).toBe('application/pdf')
  expect(headers.has('content-encoding')).toBe(false)
  expect(ArrayBuffer.isView(upload?.body) || upload?.body instanceof ArrayBuffer).toBe(true)
  expect(String(downloadUrl)).toBe(`${uploadUrl}?download=`)
  expect(download?.cache).toBe('no-store')
})
