import { getSupabase } from '../../lib/supabase/client'
import { createOpportunity, type RebootAttachment } from './matching-api'
import { withRebootAccount, type RebootAccount } from './reboot-session'

const bucket = 'reboot-attachments'
const maxBytes = 10 * 1024 * 1024
const acceptByExtension: Record<string, string> = {
  pdf: 'application/pdf',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
}
const signatures: Readonly<Record<string, readonly number[]>> = {
  'application/pdf': [0x25, 0x50, 0x44, 0x46, 0x2d], // %PDF-
  'image/jpeg': [0xff, 0xd8, 0xff],
  'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
}
export const rebootAttachmentAccept = '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png'
const attachments = () => getSupabase().storage.from(bucket)
const bidiControls = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu
const filesystemPunctuation = /[/\\:*?"<>|]/gu
const pendingKey = (userId: string) => `matching.reboot.pending:${userId}`
const activeAccounts = new Set<string>()

function pendingStorage<T>(operation: () => T) {
  try {
    return operation()
  } catch {
    throw new Error('MATCHING_REBOOT_BROWSER_STORAGE_UNAVAILABLE')
  }
}

function readPending(userId: string) {
  return pendingStorage(() => sessionStorage.getItem(pendingKey(userId)))
}

function writePending(userId: string, requestId: string | null) {
  pendingStorage(() => {
    if (requestId === null) sessionStorage.removeItem(pendingKey(userId))
    else sessionStorage.setItem(pendingKey(userId), requestId)
  })
}

export function hasPendingReboot(userId: string) {
  try {
    return readPending(userId) !== null
  } catch {
    // The write path fails closed if tab storage is inaccessible.
    return false
  }
}

async function withAttempt<T>(userId: string, work: (account: RebootAccount) => Promise<T>) {
  // Route changes (and same-account auth rechecks) may remount the form while
  // its original mutation is still active. Don't reconcile a live attempt.
  if (activeAccounts.has(userId)) throw new Error('MATCHING_REBOOT_ATTEMPT_ACTIVE')
  activeAccounts.add(userId)
  try {
    return await withRebootAccount(userId, work)
  } finally {
    activeAccounts.delete(userId)
  }
}

function requireSignature(bytes: ArrayBuffer, mime: string) {
  const expected = Object.hasOwn(signatures, mime) ? signatures[mime] : undefined
  if (!expected || bytes.byteLength < expected.length)
    throw new Error('MATCHING_REBOOT_INVALID_FILE')
  const prefix = new Uint8Array(bytes, 0, expected.length)
  if (!expected.every((value, index) => prefix[index] === value))
    throw new Error('MATCHING_REBOOT_INVALID_FILE')
}

async function pickedAttachment(file: File | null) {
  if (!file) return null
  const filename = file.name.normalize('NFC').trim()
  const ext = /.+\.([a-z]+)$/iu.exec(filename)?.[1].toLowerCase()
  const mime = ext && Object.hasOwn(acceptByExtension, ext) ? acceptByExtension[ext] : undefined
  if (!mime || (file.type && file.type !== mime) || file.size === 0 || file.size > maxBytes) {
    throw new Error('MATCHING_REBOOT_INVALID_FILE')
  }
  if (
    Array.from(filename).length > 120 ||
    filename !==
      filename
        .replace(filesystemPunctuation, '')
        .replace(bidiControls, '')
        .replace(/\p{Cc}/gu, '')
  )
    throw new Error('MATCHING_REBOOT_INVALID_FILENAME')
  // Client-side check only: Storage never exposes the actual bytes to SQL triggers.
  const bytes = await file.arrayBuffer()
  requireSignature(bytes, mime)
  return { bytes, filename, mime }
}

async function remove(account: RebootAccount, paths: string[]) {
  if (!paths.length) return
  const result = await account.storage.remove(paths)
  account.requireActive()
  if (result.error) throw result.error
}

// Abort the attempt in the DB first. If the response to publish was lost but
// publication committed, this returns the listing instead of removing its file.
async function settleAttempt(account: RebootAccount, userId: string, requestId: string) {
  try {
    const result = await account.rpc<{ opportunity_id?: string; object_path?: string | null }>(
      'cancel_matching_reboot_attempt',
      { p_request_id: requestId },
    )
    const published =
      typeof result?.opportunity_id === 'string' && result.opportunity_id
        ? result.opportunity_id
        : null
    if (published === null) {
      const path = result?.object_path
      if (path !== null && (typeof path !== 'string' || !path))
        throw new Error('MATCHING_REBOOT_CLEANUP_FAILED')
      if (path) await remove(account, [path])
    }
    await account.verifySession()
    account.requireActive()
    writePending(userId, null)
    return published
  } catch {
    account.requireActive()
    throw new Error('MATCHING_REBOOT_CLEANUP_FAILED')
  }
}

export function confirmReboot(userId: string) {
  return withAttempt(userId, (account) => {
    const pending = readPending(userId)
    return pending === null ? Promise.resolve(null) : settleAttempt(account, userId, pending)
  })
}

export function publishReboot(form: FormData, file: File | null, userId: string) {
  return withAttempt(userId, (account) => publishForAccount(account, form, file, userId))
}

async function publishForAccount(
  account: RebootAccount,
  form: FormData,
  file: File | null,
  userId: string,
) {
  const pending = readPending(userId)
  if (pending !== null) return settleAttempt(account, userId, pending)
  const picked = await pickedAttachment(file)
  account.requireActive()
  // A prior tab may have closed after uploading. Expired/cancelled files are
  // still private, and can be removed when this account next publishes.
  try {
    await remove(account, await account.rpc<string[]>('list_matching_reboot_cleanup'))
  } catch {
    // Cleanup of unrelated old files must not block a new publication.
  }
  account.requireActive()
  const requestId = crypto.randomUUID()
  // This is the only data saved across remounts or reloads. Persist it before
  // any reservation can reach the server, even if its response is lost.
  writePending(userId, requestId)
  let reserved = false
  try {
    const path = await account.rpc<string | null>('begin_matching_reboot', {
      p_request_id: requestId,
      p_filename: picked?.filename ?? null,
    })
    reserved = true
    if (picked) {
      if (!path) throw new Error('MATCHING_REBOOT_ATTACHMENT_UNAVAILABLE')
      try {
        // Blob makes the SDK use multipart, where Storage prefixes cacheControl
        // with max-age=. Send raw bytes with the exact response cache directive.
        const result = await account.storage.upload(path, picked.bytes, {
          upsert: false,
          contentType: picked.mime,
          headers: { 'Cache-Control': 'private, no-store' },
        })
        account.requireActive()
        if (result.error) throw result.error
      } catch {
        throw new Error('MATCHING_REBOOT_UPLOAD_FAILED')
      }
    }
    const id = await createOpportunity('reboot', form, {
      requestId,
      hasAttachment: !!picked,
      rpc: account.rpc,
    })
    if (typeof id !== 'string' || !id) throw new Error('MATCHING_REBOOT_CLEANUP_FAILED')
    await account.verifySession()
    account.requireActive()
    writePending(userId, null)
    return id
  } catch (error) {
    account.requireActive()
    // A PL/pgSQL rejection of begin is a confirmed rollback, not a lost reply.
    // Cancelling a nonexistent attempt at the same hourly limit would mask it.
    if (
      !reserved &&
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'P0001'
    ) {
      writePending(userId, null)
      throw error
    }
    const published = await settleAttempt(account, userId, requestId)
    if (published) return published
    throw error
  }
}

export async function downloadRebootAttachment(attachment: RebootAttachment) {
  // Storage v1.96 sets Content-Disposition only with ?download=. The pinned
  // SDK forwards this query; the bucket RLS denies requests without it.
  const { data, error } = await attachments().download(
    `${attachment.path}?download=`,
    {},
    {
      cache: 'no-store',
    },
  )
  if (error) throw error
  if (data.size !== attachment.size || data.size < 1 || data.size > maxBytes)
    throw new Error('MATCHING_REBOOT_INVALID_FILE')
  requireSignature(await data.slice(0, 8).arrayBuffer(), attachment.mime)
  // Don't open the response in the browser or create a shareable signed URL.
  const url = URL.createObjectURL(new Blob([data], { type: 'application/octet-stream' }))
  const name = attachment.filename
    .replace(filesystemPunctuation, '_')
    .replace(bidiControls, '')
    .replace(/\p{Cc}/gu, '')
    .replace(/^[. ]+|[. ]+$/gu, '')
  const link = document.createElement('a')
  link.href = url
  link.download = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])\./iu.test(name)
    ? `_${name}`
    : name || '첨부 파일'
  document.body.append(link)
  try {
    link.click()
  } finally {
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}
