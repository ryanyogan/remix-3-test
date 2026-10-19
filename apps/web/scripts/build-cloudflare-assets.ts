// Compiles the Remix asset graph ahead of time for Cloudflare, where the Worker cannot read source
// files or run the on-demand asset server. Run with NODE_ENV=production:
//
//   node scripts/build-cloudflare-assets.ts <out-dir>
//
// Writes <out-dir>/client/ (fingerprinted assets and public/ files) for Workers Static Assets, and
// <out-dir>/manifest.json with the script entries the Worker renders. The Worker serves /assets/*
// from there itself (app/platform/cloudflare/worker.ts), so files are stored under assetKey().
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { buildEditor } from './build-editor.mjs'

await buildEditor()

import { assetKey } from '../app/platform/cloudflare/asset-key.ts'

if (process.env.NODE_ENV !== 'production') {
  throw new Error('Build Cloudflare assets with NODE_ENV=production so they are fingerprinted')
}

const rootDir = process.cwd()
const outDir = path.resolve(process.argv[2] ?? '.remix-cloudflare')
const clientDir = path.join(outDir, 'client')

const { assets, fontPreloads, scriptEntry, stylesheetHref } = await import('../app/assets.ts')

type ScriptEntry = typeof scriptEntry

// clientEntry(import.meta.url, ...) modules. The Vite plugin rewrites import.meta.url in app files
// to the same file:///<path from root> IDs used as keys here.
const clientEntries: Record<string, ScriptEntry> = {}
for await (let file of fs.glob('app/**/public/**/*.{ts,tsx}', { cwd: rootDir })) {
  if (/\.test\./.test(file)) continue
  let source = await fs.readFile(path.join(rootDir, file), 'utf8')
  if (!source.includes('clientEntry(')) continue
  clientEntries[clientEntryId(file)] = await assets.getScriptEntry(file)
}

let pending = new Set<string>([stylesheetHref, ...fontPreloads])
for (let entry of [scriptEntry, ...Object.values(clientEntries)]) {
  collectEntryUrls(entry, pending)
}

await fs.rm(outDir, { recursive: true, force: true })
await fs.mkdir(clientDir, { recursive: true })

let written = new Set<string>()
while (pending.size > 0) {
  let [url] = pending
  pending.delete(url)
  if (written.has(url)) continue
  written.add(url)

  let response = await assets.fetch(new Request(new URL(url, 'http://localhost')))
  if (!response?.ok) throw new Error(`Asset ${url} failed to build (${response?.status ?? 404})`)

  let body = new Uint8Array(await response.arrayBuffer())
  let file = path.join(clientDir, assetKey(new URL(url, 'http://localhost').pathname))
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, body)

  if (url.endsWith('.css')) {
    for (let ref of cssReferences(new TextDecoder().decode(body), url)) pending.add(ref)
  }
}

await fs.cp(path.join(rootDir, 'public'), clientDir, { recursive: true })
await fs.writeFile(
  path.join(outDir, 'manifest.json'),
  JSON.stringify({ scriptEntry, stylesheetHref, fontPreloads, clientEntries }, null, 2),
)

console.log(`Built ${written.size} assets and ${Object.keys(clientEntries).length} client entries`)
process.exit(0)

function clientEntryId(file: string) {
  return 'file:///' + file.split(path.sep).join('/')
}

function collectEntryUrls(entry: ScriptEntry, urls: Set<string>) {
  urls.add(entry.href)
  for (let preload of entry.preloads) urls.add(preload)
  let { imports = {}, scopes = {} } = entry.importMap ?? {}
  for (let map of [imports, ...Object.values(scopes)]) {
    for (let target of Object.values(map)) urls.add(target)
  }
}

// Same-origin @import and url() targets, resolved against the stylesheet URL.
function cssReferences(css: string, fromUrl: string): string[] {
  let refs: string[] = []
  let pattern = /@import\s+(?:url\()?\s*['"]?([^'")\s;]+)|url\(\s*['"]?([^'")]+)['"]?\s*\)/g
  for (let match of css.matchAll(pattern)) {
    let ref = match[1] ?? match[2]
    if (!ref || /^(data:|https?:|#)/.test(ref)) continue
    let resolved = new URL(ref, new URL(fromUrl, 'http://localhost'))
    if (resolved.origin === 'http://localhost') refs.push(resolved.pathname)
  }
  return refs
}
