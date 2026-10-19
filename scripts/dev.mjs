import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { buildEditor } from '../apps/web/scripts/build-editor.mjs'

await buildEditor()

let production = process.argv.includes('--production')
let port = process.env.PORT ?? '44100'
let apiPort = process.env.API_PORT ?? String(Number(port) + 10)
let env = { ...process.env, NODE_ENV: production ? 'production' : 'development',
  WEB_ORIGIN: `http://localhost:${port}`, API_ORIGIN: `http://127.0.0.1:${apiPort}`, API_PORT: apiPort }
let children = [], stopping = false
function stop(code = 0) {
  if (stopping) return
  stopping = true
  for (let child of children) { try { process.kill(-child.pid, 'SIGTERM') } catch {} }
  process.exitCode = code
}
function start(app, args, stdio) {
  let child = spawn(process.execPath, args, { cwd: fileURLToPath(new URL(`../apps/${app}`, import.meta.url)), env, stdio, detached: true })
  children.push(child)
  child.on('error', error => { console.error(error); stop(1) })
  child.on('exit', code => stop(code ?? 0))
  return child
}
// Finish the API's local migrations before starting web against the same SQLite file.
let api = start('api', [...(production ? [] : ['--watch']), '--import', 'remix/node-tsx', 'server.ts'], ['inherit', 'pipe', 'inherit'])
let started = false
api.stdout.on('data', chunk => {
  process.stdout.write(chunk)
  if (!started && chunk.toString().includes('Hono API ready')) {
    started = true
    start('web', production ? ['--import', 'remix/node-tsx', 'server.ts'] : ['hmr.ts'], 'inherit')
  }
})
for (let signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop())
