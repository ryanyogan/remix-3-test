import { build } from 'vite'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

// Lexxy includes CommonJS syntax highlighters. Compile that dependency graph to
// browser ESM once; Remix still serves and fingerprints the resulting module.
export async function buildEditor() {
  const require = createRequire(import.meta.url)
  await build({
    configFile: false,
    logLevel: 'warn',
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    build: {
      outDir: fileURLToPath(new URL('../app/actions/public/lexxy/runtime', import.meta.url)),
      emptyOutDir: true,
      lib: { entry: require.resolve('@37signals/lexxy'), formats: ['es'], fileName: () => 'lexxy.js' },
      minify: true,
    },
  })
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await buildEditor()
