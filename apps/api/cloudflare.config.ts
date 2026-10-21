import { bindings, defineConfig, triggers } from 'cf/config'

export default defineConfig({
  worker: {
    name: 'trellix-api',
    entrypoint: './src/worker.ts',
    compatibilityDate: '2026-09-28',
    compatibilityFlags: ['nodejs_compat'],
    domains: ['api.trellix.yogan.dev'],
    triggers: [triggers.fetch({ pattern: 'trellix.yogan.dev/api/v1*', zone: 'yogan.dev' })],
    placement: { mode: 'smart' },
    observability: {
      enabled: true,
      headSamplingRate: 1,
      logs: { enabled: true, invocationLogs: true },
      traces: { enabled: true, headSamplingRate: 1 },
    },
    env: {
      DB: bindings.d1({ id: '8ec80d3b-b315-46c4-aa9c-0459d2a4ab3d', name: 'trellix' }),
      UPLOADS: bindings.r2({ name: 'trellix-uploads' }),
      SESSION_SECRET: bindings.secret(),
    },
  },
})
