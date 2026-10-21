import { createD1Database, type D1Like } from '@trellix/data/d1-database'
import { createR2FileStorage, type R2Like } from '@trellix/data/r2-file-storage'
import { createApi } from './app.ts'
import { serveApi, type Api } from './handler.ts'

interface Env { DB: D1Like; UPLOADS: R2Like; SESSION_SECRET: string }

// Built on the first request and reused by the isolate; routes hold no per-request state.
let api: Api | undefined

export default {
  fetch(request: Request, env: Env) {
    api ??= createApi()
    // Per-request adapters keep D1 transaction state isolated between requests.
    return serveApi(api, request, { db: createD1Database(env.DB), uploads: createR2FileStorage(env.UPLOADS), secret: env.SESSION_SECRET })
  },
}
