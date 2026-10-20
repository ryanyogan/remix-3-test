import { clientEntry, type Handle } from 'remix/component'

// Rendered into a frame whose request found no session. A frame can only replace its own
// region, so this sends the whole page to sign in instead of showing the login form inside it.
export const SignedOut = clientEntry(import.meta.url, function SignedOut(handle: Handle<{ href: string }>) {
  handle.queueTask(() => { location.assign(handle.props.href) })
  return () => <p role="status">Your session has ended. <a href={handle.props.href} data-rmx-document>Sign in again</a></p>
})
