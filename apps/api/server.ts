import * as http from 'node:http'
import { fileURLToPath } from 'node:url'
import { createSqliteDatabase } from 'remix/data-table/sqlite'
import { loadMigrations } from 'remix/data-table/migrations/node'
import { createFsFileStorage } from 'remix/file-storage/fs'
import { createRequestListener } from 'remix/node-fetch-server'
import { createApiHandler } from './src/handler.ts'

let db = createSqliteDatabase({ filename: process.env.DATABASE_FILE ?? fileURLToPath(new URL('../../db/app.sqlite', import.meta.url)), foreignKeys: true })
await db.migrate(await loadMigrations(fileURLToPath(new URL('../../packages/data/migrations', import.meta.url))))
let secret = process.env.SESSION_SECRET ?? (process.env.NODE_ENV === 'production' ? '' : 'dev-only-session-secret')
if (!secret) throw new Error('SESSION_SECRET must be set in production')
let handler = createApiHandler({ db, secret, browserOrigin: process.env.WEB_ORIGIN,
  uploads: createFsFileStorage(process.env.UPLOADS_DIR ?? fileURLToPath(new URL('../../uploads', import.meta.url))),
})
let server = http.createServer(createRequestListener(handler))
server.listen(Number(process.env.API_PORT ?? 44110), '127.0.0.1', () => console.log('Hono API ready'))
for (let signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => server.close(async () => { await db.close(); process.exit() }))
