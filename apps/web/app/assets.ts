import { createAssetServer } from 'remix/assets'
import { componentHmr } from 'remix/component-hmr/assets'

const rootDir = process.cwd()
const nodeEnv = process.env.NODE_ENV ?? 'development'
const isDevelopment = nodeEnv === 'development'
const isHmr = Boolean(isDevelopment && process.env.REMIX_NODE_HMR)

export const assets = createAssetServer({
  basePath: '/assets',
  rootDir,
  mounts: { app: 'app', npm: '../../node_modules', contracts: '../../packages/contracts' },

  allowFiles: ['app/routes.ts', 'app/data/limits.ts', 'app/**/public/**'],
  allowPackages: ['remix', '@remix-run/ui', '@trellix/contracts'],
  denyFiles: ['app/**/*.test.*'],
  files: { extensions: ['.woff2'] },
  sourceMaps: isDevelopment ? 'external' : undefined,
  minify: !isDevelopment,
  watch: isDevelopment,
  // Content-hashed URLs let the Cloudflare build serve assets as immutable static files.
  fingerprint: nodeEnv === 'production',
  hmr: isHmr
    ? {
        channel: async () => (await import('remix/node-hmr/runtime')).createBrowserHmrChannel(),
        moduleImporter: 'remix/multiple-import-maps-polyfill',
      }
    : undefined,
  scripts: { loaders: isHmr ? [componentHmr()] : undefined },
})

const entry = 'app/actions/public/entry.ts'

export const scriptEntry = await assets.getScriptEntry(entry)

// Global styles: the Trellix theme (tokens, themes, component classes, keyframes).
export const stylesheetHref = await assets.getHref('app/actions/public/app.css')

// Fizzy's system font stack uses installed fonts, so no font downloads are needed.
export const fontPreloads: string[] = []
