import { DataTableValidationError } from 'remix/data-table'
import { createFileResponse } from 'remix/response/file'
import type { Services, StoredDownload } from '@trellix/data/operation-context'
import { OperationError } from '@trellix/data/operation-errors'
import type { AppContext } from '../../router.ts'

// Route actions own HTTP; shared operations only receive authenticated services and values.
export async function dataResponse(
  context: Pick<AppContext, 'db' | 'uploads' | 'auth'>,
  run: (services: Services) => Promise<unknown>,
) {
  try {
    let user = context.auth.ok ? context.auth.identity : null
    if (!user) throw new OperationError(401, { message: 'Sign in to continue' })
    let data = await run({ db: context.db, uploads: context.uploads, user })
    if (data instanceof Response) return data
    return data === undefined
      ? new Response(null, { status: 204, headers: privateHeaders })
      : Response.json({ data }, { headers: privateHeaders })
  } catch (error) {
    if (error instanceof OperationError)
      return Response.json(
        { error: error.message },
        { status: error.status, headers: privateHeaders },
      )
    if (error instanceof DataTableValidationError)
      return Response.json({ error: 'Invalid value' }, { status: 422, headers: privateHeaders })
    console.error('App action failed', error)
    return Response.json(
      { error: 'Could not complete that request. Please try again.' },
      { status: 500, headers: privateHeaders },
    )
  }
}

export const privateHeaders = { 'Cache-Control': 'private, no-store' }

export async function input(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/json')
    throw new OperationError(415, { message: 'Expected JSON' })
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
