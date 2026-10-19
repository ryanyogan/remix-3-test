import type { Database } from 'remix/data-table'
import type { FileStorage } from 'remix/file-storage'
import { readSessionUser } from '@trellix/session'
import { createApi } from './app.ts'

export function createApiHandler(options: { db: Database; uploads: FileStorage; secret: string; browserOrigin?: string }) {
  let api = createApi()
  return async (request: Request) => {
    let sessionUserId = request.headers.has('Authorization') || new URL(request.url).pathname === '/api/v1/health'
      ? null : await readSessionUser(request, options.secret)
    let response = await api.fetch(request, { ...options, sessionUserId })
    response.headers.set('X-Trellix-Service', 'api')
    return response
  }
}
