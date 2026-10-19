import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { Plugin } from 'vite'

const manifestId = 'virtual:remix-asset-manifest'

let assetsBuilt = false

// Builds the Remix app for Workers:
//
// - Prebuilds the asset graph (scripts/build-cloudflare-assets.ts) into the static assets dir and
//   exposes its script entries as `virtual:remix-asset-manifest`.
// - Swaps Node-only modules (SQLite, filesystem uploads, the on-demand asset server, static file
//   middleware) for the D1, R2, and prebuilt versions in this directory.
// - Rewrites `import.meta.url` in app modules to stable `file:///<path>` IDs, which the bundled
//   Worker would otherwise lose, so `clientEntry()` IDs match the prebuilt manifest.
export function remixCloudflare(): Plugin {
  let root = process.cwd()
  let outDir = path.join(root, '.remix-cloudflare')
  let appDir = path.join(root, 'app') + path.sep
  let platformDir = path.join(root, 'app/platform/cloudflare')

  let replacements = new Map([
    [path.join(root, 'app/db.ts'), path.join(platformDir, 'db.ts')],
    [path.join(root, 'app/data/uploads.ts'), path.join(platformDir, 'uploads.ts')],
    [path.join(root, 'app/assets.ts'), path.join(platformDir, 'assets.ts')],
  ])

  return {
    name: 'remix-cloudflare',
    enforce: 'pre',

    config() {
      // Vite resolves config more than once per build; prebuild the assets only once.
      if (!assetsBuilt) {
        assetsBuilt = true
        execFileSync(
          process.execPath,
          [path.join(root, 'scripts/build-cloudflare-assets.ts'), outDir],
          { cwd: root, stdio: 'inherit', env: { ...process.env, NODE_ENV: 'production' } },
        )
      }
      return { publicDir: path.join(outDir, 'client') }
    },

    resolveId(source, importer) {
      if (source === manifestId) return '\0' + manifestId
      if (source === 'remix/middleware/static') return path.join(platformDir, 'static-files.ts')
      if (!importer || !source.startsWith('.')) return null

      let resolved = path.resolve(path.dirname(importer.split('?')[0]), source)
      return replacements.get(resolved) ?? null
    },

    load(id) {
      if (id !== '\0' + manifestId) return null
      let manifest = JSON.parse(fs.readFileSync(path.join(outDir, 'manifest.json'), 'utf8'))
      return Object.entries(manifest)
        .map(([name, value]) => `export const ${name} = ${JSON.stringify(value)}`)
        .join('\n')
    },

    transform(code, id) {
      let file = id.split('?')[0]
      if (!file.startsWith(appDir) || file.startsWith(platformDir)) return null
      if (!code.includes('import.meta.url')) return null

      let entryId = 'file:///' + path.relative(root, file).split(path.sep).join('/')
      return { code: code.replaceAll('import.meta.url', JSON.stringify(entryId)), map: null }
    },
  }
}
