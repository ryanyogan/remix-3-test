import { cloudflare } from '@cloudflare/vite-plugin'
import { defineConfig } from 'vite'

import { remixCloudflare } from './app/platform/cloudflare/vite-plugin.ts'

// Builds the Cloudflare Worker (`cf build` / `cf deploy`). Local Node development still runs
// through server.ts with `npm run dev`.
export default defineConfig({
  // Bindings are typed in app/platform/cloudflare/env.d.ts; generated runtime types would leak
  // Workers globals into the Node app's type checking.
  plugins: [remixCloudflare(), cloudflare({ types: { generate: false } })],
  oxc: {
    jsx: { runtime: 'automatic', importSource: 'remix/component' },
  },
})
