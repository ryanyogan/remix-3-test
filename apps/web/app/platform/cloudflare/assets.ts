// Worker replacement for app/assets.ts. Assets are compiled at build time and served by Workers
// Static Assets, so this only answers lookups from the prebuilt manifest.
import {
  clientEntries,
  fontPreloads,
  scriptEntry,
  stylesheetHref,
} from 'virtual:remix-asset-manifest'

export { fontPreloads, scriptEntry, stylesheetHref }

export const assets = {
  // Static Assets serve every built file before the Worker runs, so anything reaching here is missing.
  async fetch(_request: Request): Promise<Response | null> {
    return null
  },
  async getScriptEntry(entryId: string) {
    let entry = clientEntries[entryId]
    if (!entry) throw new Error(`No prebuilt client entry for ${entryId}`)
    return entry
  },
}
