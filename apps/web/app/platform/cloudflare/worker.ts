import './ssr-signal-shim.ts'
import { router } from '../../router.ts'
import { assetContentType, assetKey } from './asset-key.ts'

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    let url = new URL(request.url)
    try {
      let response = url.pathname.startsWith('/assets/')
        ? await serveAsset(request, url, env)
        : await router.fetch(request)
      return withSecurityHeaders(response)
    } catch (error) {
      // router.fetch() rejects when an action or middleware throws. Report it and answer with
      // a generic 500 rather than the platform's error page, which skips the security headers.
      if (!request.signal.aborted) console.error('Unhandled request error', error)
      return withSecurityHeaders(new Response('Internal Server Error', { status: 500 }))
    }
  },
}

const securityHeaders = {
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Cross-Origin-Opener-Policy': 'same-origin',
}

function withSecurityHeaders(response: Response): Response {
  let secured = new Response(response.body, response)
  for (let [name, value] of Object.entries(securityHeaders)) {
    if (!secured.headers.has(name)) secured.headers.set(name, value)
  }
  return secured
}

// Prebuilt assets (see scripts/build-cloudflare-assets.ts), answered before the router so asset
// requests skip sessions and the database.
async function serveAsset(request: Request, url: URL, env: Env): Promise<Response> {
  // Static Assets redirect any path that is not in their canonical (percent-encoded) form, so
  // look the key up encoded segment by segment, and follow a redirect internally just in case.
  let key: string
  try { key = assetKey(url.pathname) } catch { return new Response('Not Found', { status: 404 }) }
  let pathname = key.split('/').map(encodeURIComponent).join('/')
  let response = await env.ASSETS.fetch(new Request(new URL(pathname, url), request))
  let location = response.headers.get('Location')
  if (response.status >= 300 && response.status < 400 && location) {
    response = await env.ASSETS.fetch(new Request(new URL(location, url), request))
  }
  if (!response.ok) return response

  let headers = new Headers(response.headers)
  let contentType = assetContentType(url.pathname)
  if (contentType) headers.set('Content-Type', contentType)
  // Fingerprinted URLs (name.@hash.ext) never change content.
  if (url.pathname.includes('.@')) {
    headers.set('Cache-Control', 'public, max-age=31536000, immutable')
  }
  return new Response(response.body, { status: response.status, headers })
}
