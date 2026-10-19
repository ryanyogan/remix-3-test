// Worker replacement for remix/middleware/static: Workers Static Assets serve public/ files.
import type { Middleware } from 'remix/router'

export function staticFiles(..._args: unknown[]): Middleware {
  return (_context, next) => next()
}
