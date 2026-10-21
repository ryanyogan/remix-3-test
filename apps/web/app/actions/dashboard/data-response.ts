import { DataTableValidationError } from 'remix/data-table'
import { createFileResponse } from 'remix/response/file'
import { redirect } from 'remix/response/redirect'
import type { Services, StoredDownload } from '@trellix/data/operation-context'
import { OperationError } from '@trellix/data/operation-errors'
import type { AppContext } from '../../router.ts'

// How an action answers a plain form post, which the browser sends without JavaScript.
export interface FormReply {
  // The page to see after the write succeeds.
  redirect: string | ((data: unknown) => string)
  // The page again, showing why the write was rejected. Plain text when omitted.
  rejected?: (message: string, status: number) => Response | Promise<Response>
}

// Route actions own HTTP; shared operations only receive authenticated services and values.
// Enhanced fetch() calls get JSON. With `form`, a plain form post gets a redirect or the page.
export async function dataResponse(
  context: Pick<AppContext, 'db' | 'uploads' | 'auth' | 'request'>,
  run: (services: Services) => Promise<unknown>,
  form?: FormReply,
) {
  let plain = form && !wantsJson(context.request)
  let status: number, message: string
  try {
    let user = context.auth.ok ? context.auth.identity : null
    if (!user) throw new OperationError(401, { message: 'Sign in to continue' })
    let data = await run({ db: context.db, uploads: context.uploads, user })
    if (data instanceof Response) return data
    if (plain)
      return redirect(typeof form!.redirect === 'string' ? form!.redirect : form!.redirect(data), 303)
    return data === undefined
      ? new Response(null, { status: 204, headers: privateHeaders })
      : Response.json({ data }, { headers: privateHeaders })
  } catch (error) {
    if (error instanceof OperationError) {
      status = error.status
      message = error.message
    } else if (error instanceof DataTableValidationError) {
      status = 422
      message = 'Invalid value'
    } else {
      console.error('App action failed', error)
      status = 500
      message = 'Could not complete that request. Please try again.'
    }
  }
  if (plain)
    return form!.rejected
      ? form!.rejected(message, status)
      : new Response(message, { status, headers: privateHeaders })
  return Response.json({ error: message }, { status, headers: privateHeaders })
}

function wantsJson(request: Request) {
  return request.headers.get('Accept')?.includes('application/json') ?? false
}

export const privateHeaders = { 'Cache-Control': 'private, no-store' }

// How a plain form field becomes the value the shared operation validates, as JSON would send it.
// `boolean` reads the last value, so a hidden "false" can precede a checkbox's "true".
export type FieldKind = 'boolean' | 'number' | 'list' | 'nullable'

// Enhanced clients send JSON; plain form posts send text fields, converted as `kinds` names.
export async function input(
  context: Pick<AppContext, 'request' | 'formData'>,
  kinds: Record<string, FieldKind> = {},
): Promise<Record<string, unknown>> {
  let type = context.request.headers.get('Content-Type')?.split(';')[0].trim()
  if (type === 'application/json') return json(context.request)
  if (type !== 'application/x-www-form-urlencoded' && type !== 'multipart/form-data')
    throw new OperationError(415, { message: 'Expected JSON or a form' })
  let values: Record<string, unknown> = {}
  for (let name of new Set(context.formData.keys())) {
    let all = context.formData.getAll(name).filter((value) => typeof value === 'string')
    if (!all.length) continue
    let value = all[0]
    switch (kinds[name]) {
      case 'boolean':
        value = all.at(-1)!
        values[name] = value === 'true' ? true : value === 'false' ? false : value
        break
      case 'number':
        values[name] = value === '' ? undefined : Number(value)
        break
      case 'list':
        values[name] = all.filter(Boolean)
        break
      case 'nullable':
        values[name] = value === '' ? null : value
        break
      default:
        values[name] = value
    }
  }
  return values
}

async function json(request: Request): Promise<Record<string, unknown>> {
  // Bound bytes actually read, including chunked bodies without Content-Length.
  let reader = request.body?.getReader(),
    chunks: Uint8Array[] = [],
    size = 0
  if (!reader) throw new OperationError(400, { message: 'Expected a JSON object' })
  try {
    while (true) {
      let { done, value } = await reader.read()
      if (done || !value) break
      size += value.byteLength
      if (size > 64 * 1024) {
        await reader.cancel()
        throw new OperationError(413, { message: 'Request is too large' })
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  try {
    let bytes = new Uint8Array(size),
      offset = 0
    for (let chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    let value: unknown = JSON.parse(new TextDecoder().decode(bytes))
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error()
    return value as Record<string, unknown>
  } catch {
    throw new OperationError(400, { message: 'Expected a JSON object' })
  }
}

export async function downloadResponse(request: Request, download: StoredDownload) {
  let response = await createFileResponse(download.file, request, {
    cacheControl: 'private, no-store',
  })
  response.headers.set(
    'Content-Disposition',
    `${download.disposition}; filename*=UTF-8''${encodeURIComponent(download.name ?? download.file.name)}`,
  )
  response.headers.set('X-Content-Type-Options', 'nosniff')
  if (download.sandbox)
    response.headers.set('Content-Security-Policy', "sandbox; default-src 'none'")
  return response
}
