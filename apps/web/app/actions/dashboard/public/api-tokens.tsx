import { routes } from '../../../routes.ts'
import { clientEntry, on, type Handle } from 'remix/component'
import { appRequest } from './app-request.ts'

export interface AccessToken { id: string; name: string; created_at: number }

// Real forms, so tokens can be managed without JavaScript. Enhanced, they post in the background
// and reload the page's data; a new token's secret is kept here, since it is only sent once.
export const ApiTokens = clientEntry(import.meta.url, function ApiTokens(handle: Handle<{ tokens: AccessToken[]; secret?: string; error?: string }>) {
  let secret: string | undefined
  let error: string | undefined
  let busy = false
  async function send(event: SubmitEvent & { currentTarget: HTMLFormElement }) {
    event.preventDefault()
    let form = event.currentTarget
    busy = true; error = ''; secret = ''; handle.update()
    try {
      let data = await appRequest<{ token: string } | undefined>(form.action, 'POST', new FormData(form))
      if (data) { secret = data.token; form.reset() }
      await handle.frame.reload()
    } catch (e) { error = (e as Error).message }
    finally { busy = false; if (!handle.signal.aborted) handle.update() }
  }
  return () => {
    let { tokens } = handle.props
    let shown = secret ?? handle.props.secret
    let problem = error ?? handle.props.error
    return <section class="panel token-panel">
      <h2>Make it yours.</h2>
      <p class="muted">Connect scripts and tools with the Trellix API. Tokens can read and change your boards. Revoke them any time.</p>
      <a href="/api" class="btn btn-ghost">Read the API guide →</a>
      <form class="inline-compose" method="post" action={routes.dashboard.tokens.create.href()} mix={on('submit', send)}><input class="field" name="name" aria-label="Token name" placeholder="e.g. My automation" required maxLength={80} disabled={busy} /><button class="btn btn-primary" disabled={busy}>Create token</button></form>
      {shown && <div><p>Copy this token now. It is only shown once.</p><code class="token-secret">{shown}</code><a class="btn btn-ghost" href={routes.dashboard.account.href()} mix={on('click', (event) => { event.preventDefault(); secret = ''; handle.update() })}>I’ve saved it</a></div>}
      <ul class="step-list">{tokens.map((token) => <li key={token.id}><span>{token.name} <small class="mono">{new Date(token.created_at).toLocaleDateString()}</small></span><form method="post" action={routes.dashboard.tokens.revoke.href({ tokenId: token.id })} mix={on('submit', send)}><button class="btn btn-ghost" disabled={busy}>Revoke</button></form></li>)}</ul>
      {tokens.length === 0 && <p class="mono">No active tokens.</p>}
      {problem && <p class="alert" role="alert">{problem}</p>}
    </section>
  }
})
