import * as http from 'node:http'
import { createRequestListener } from 'remix/node-fetch-server'

import { db, migrateDatabase } from './app/db.ts'
import { router } from './app/router.ts'

await migrateDatabase()

const port = process.env.PORT ? Number.parseInt(process.env.PORT, 10) : 44100
const hmrProxyPort = process.env.HMR_PROXY_PORT
  ? Number.parseInt(process.env.HMR_PROXY_PORT, 10)
  : null
const isHmr = process.env.REMIX_NODE_HMR === '1'

const server = http.createServer(createRequestListener((request) => {
  let url = new URL(request.url)
  if (url.pathname === '/api/v1' || url.pathname.startsWith('/api/v1/')) {
    let forwarded = new Request(new URL(url.pathname + url.search, process.env.API_ORIGIN ?? 'http://127.0.0.1:44110'), request)
    // The HMR HTTP proxy can add chunked transfer headers; fetch owns transport framing.
    for (let name of ['host', 'connection', 'transfer-encoding', 'content-length', 'keep-alive', 'upgrade']) forwarded.headers.delete(name)
    return fetch(forwarded)
  }
  return router.fetch(request)
}, { trustProxy: isHmr }))

server.listen(port, () => {
  if (isHmr) {
    import('remix/node-hmr/runtime').then((nodeHmr) => nodeHmr.emitServerReady())
  }

  console.log(`Server listening on http://localhost:${hmrProxyPort ?? port}`)
})

let shuttingDown = false

function shutdown() {
  if (shuttingDown) {
    return
  }

  shuttingDown = true
  server.close(async () => {
    await db.close()
    process.exit(0)
  })
  server.closeAllConnections()
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
