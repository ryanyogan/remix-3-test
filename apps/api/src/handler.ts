import type { Database } from 'remix/data-table'
import type { FileStorage } from 'remix/file-storage'
import { readSessionUser } from '@trellix/session'
import { createApi } from './app.ts'

export type Api = ReturnType<typeof createApi>
export interface ApiOptions { db: Database; uploads: FileStorage; secret: string; browserOrigin?: string }

export function createApiHandler(options: ApiOptions) {
  let api = createApi()
  return (request: Request) => serveApi(api, request, options)
}

export async function serveApi(api: Api, request: Request, options: ApiOptions) {
  let session = request.headers.has('Authorization') || new URL(request.url).pathname === '/api/v1/health'
    ? null : await readSessionUser(request, options.secret)
  let response = await api.fetch(request, { ...options, sessionUserId: session?.userId ?? null, sessionVersion: session?.version ?? 0 })
  response.headers.set('X-Trellix-Service', 'api')
  return response
}
