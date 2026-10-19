import { cop } from 'remix/middleware/cop'
import type { Middleware } from 'remix/router'

function denied() {
  return Response.json(
    { error: 'A same-origin request is required' },
    {
      status: 403,
      headers: { 'Cache-Control': 'private, no-store' },
    },
  )
}

// Keep the consumer API's strict Origin policy for cookie-authenticated app writes.
// Remix also checks browser provenance, before we parse any upload or JSON body.
export function sameOrigin(): Middleware {
  let protect = cop({ onDeny: denied })
  return (context, next) => {
    let request = context.request,
      url = new URL(request.url)
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
      url.pathname.startsWith('/dashboard') &&
      request.headers.get('Origin') !== url.origin
    )
      return denied()
    return protect(context, next)
  }
}
