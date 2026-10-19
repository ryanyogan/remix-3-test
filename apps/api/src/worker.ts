import { createD1Database, type D1Like } from '@trellix/data/d1-database'
import { createR2FileStorage, type R2Like } from '@trellix/data/r2-file-storage'
import { createApiHandler } from './handler.ts'

interface Env { DB: D1Like; UPLOADS: R2Like; SESSION_SECRET: string }

export default {
  fetch(request: Request, env: Env) {
    // Per-request adapters keep D1 transaction state isolated between requests.
    return createApiHandler({ db: createD1Database(env.DB), uploads: createR2FileStorage(env.UPLOADS), secret: env.SESSION_SECRET })(request)
  },
}
