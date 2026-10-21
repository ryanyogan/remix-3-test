import { bindings, defineConfig } from 'cf/config'

export default defineConfig({
  worker: {
    name: 'trellix',
    entrypoint: './app/platform/cloudflare/worker.ts',
    compatibilityDate: '2026-09-28',
    // node:crypto (scrypt password hashing), Buffer, and process.env for SESSION_SECRET/NODE_ENV.
    compatibilityFlags: ['nodejs_compat'],
    domains: ['trellix.yogan.dev'],
    // Run near D1 instead of near the visitor: pages make several sequential queries.
    placement: { mode: 'smart' },
    assets: {
      // The Worker serves /assets/* itself to fix module MIME types and cache headers. Under Smart
      // Placement this serves them from near D1, but direct serving is not an option: Static
      // Assets 307-redirect every `name.@hash.ext` URL to its `%40` form, and the redirected
      // response skips `_headers`, so .ts/.tsx modules would lose their JavaScript type. Assets
      // are immutable for a year, so only first visits pay for the trip.
      runWorkerFirst: ['/assets/*'],
    },
    observability: {
      enabled: true,
      headSamplingRate: 1,
      logs: { enabled: true, invocationLogs: true },
      traces: { enabled: true, headSamplingRate: 1 },
    },
    env: {
      ASSETS: bindings.assets(),
      DB: bindings.d1({ id: '8ec80d3b-b315-46c4-aa9c-0459d2a4ab3d', name: 'trellix' }),
      UPLOADS: bindings.r2({ name: 'trellix-uploads' }),
      SESSION_SECRET: bindings.secret(),
      NODE_ENV: bindings.text('production'),
    },
  },
})
