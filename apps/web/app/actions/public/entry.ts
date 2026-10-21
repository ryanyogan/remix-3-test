import {
  detectMultipleImportMapSupport,
  importModule,
  preloadShim,
} from 'remix/multiple-import-maps-polyfill'
import { run } from 'remix/component'

// A client navigation commits its URL before the page arrives. When the response can't be shown (a
// server error, a dropped connection), reload that URL as a document so the browser shows what the
// server actually sent instead of leaving the previous page under the new address. Registered
// before run() so the reload skips the runtime's interception, which would only fail again.
let reloadingDocument = false
window.navigation?.addEventListener('navigate', (event) => {
  if (reloadingDocument) event.stopImmediatePropagation()
})
window.navigation?.addEventListener('navigateerror', (event) => {
  if (reloadingDocument) return
  if (event.error instanceof DOMException && event.error.name === 'AbortError') return
  reloadingDocument = true
  location.reload()
})

const app = run({
  async loadModule(moduleUrl, exportName) {
    let mod = await importModule(moduleUrl)
    let Component = mod[exportName]
    if (typeof Component !== 'function') {
      throw new Error(`Unknown component: ${moduleUrl}#${exportName}`)
    }
    return Component
  },
  async processClientEntryPreloads(preloads) {
    if (await detectMultipleImportMapSupport()) return preloads

    preloadShim(preloads)
    return []
  },
})

// Hydration, component, scheduler, and frame failures surface here rather than as uncaught errors.
app.addEventListener('error', (event) => {
  console.error('Remix runtime error', event.error)
})

if (import.meta.hot) {
  import.meta.hot.on('server:update', async () => {
    try {
      await app.ready()
      await app.frames.top.reload()
    } catch (error) {
      console.error('Error reloading top frame on server update', error)
    }
  })
}
