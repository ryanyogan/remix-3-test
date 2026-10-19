// Bindings declared in cloudflare.config.ts, typed with the slices this app uses.
declare module 'cloudflare:workers' {
  export const env: {
    DB: import('./d1-database.ts').D1Like
    UPLOADS: import('./r2-file-storage.ts').R2Like
  }
}

// Written by scripts/build-cloudflare-assets.ts and served by vite-plugin.ts.
declare module 'virtual:remix-asset-manifest' {
  type ScriptEntry = {
    href: string
    importMap: { imports: Record<string, string>; scopes?: Record<string, Record<string, string>> }
    preloads: string[]
  }
  export const scriptEntry: ScriptEntry
  export const stylesheetHref: string
  export const fontPreloads: string[]
  export const clientEntries: Record<string, ScriptEntry>
}
