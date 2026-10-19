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
      // The Worker serves /assets/* itself to fix module MIME types and cache headers.
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
