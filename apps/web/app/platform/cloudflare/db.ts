// Worker replacement for app/db.ts: the app database is the D1 binding. Migrations run with
// `cf d1 migrations apply`, not at startup.
import { env } from 'cloudflare:workers'

import { createD1Database } from './d1-database.ts'

export const db = createD1Database(env.DB)
