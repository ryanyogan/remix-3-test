import { routes } from '../../../routes.ts'
import { clientEntry, on, type Handle } from 'remix/component'
import { appRequest } from './app-request.ts'

interface Token { id: string; name: string; created_at: number }
export const ApiTokens = clientEntry(import.meta.url, function ApiTokens(handle: Handle) {
  let tokens: Token[] | undefined
  let secret = ''
  let error = ''
  let busy = false
  async function load() {
    try { tokens = await appRequest<Token[]>(routes.dashboard.tokens.index.href()) }
    catch (e) { error = (e as Error).message }
    handle.update()
  }
  return () => <section class="panel token-panel">
    <h2>Make it yours.</h2>
    <p class="muted">Connect scripts and tools with the Trellix API. Tokens can read and change your boards. Revoke them any time.</p>
    <a href="/api" class="btn btn-ghost">Read the API guide →</a>
    {tokens === undefined ? <button class="btn btn-ghost" type="button" mix={on('click', load)}>Manage access tokens</button> : <>
      <form class="inline-compose" mix={on('submit', async (event) => {
        event.preventDefault(); let form = event.currentTarget
        busy = true; error = ''; secret = ''; handle.update()
        try {
          let data = await appRequest<{ token: string }>(routes.dashboard.tokens.create.href(), 'POST', { name: new FormData(form).get('name') })
          secret = data.token; form.reset(); await load()
        } catch (e) { error = (e as Error).message }
        finally { busy = false; handle.update() }
      })}><input class="field" name="name" aria-label="Token name" placeholder="e.g. My automation" required maxLength={80} disabled={busy} /><button class="btn btn-primary" disabled={busy}>Create token</button></form>
      {secret && <div><p>Copy this token now. It is only shown once.</p><code class="token-secret">{secret}</code><button class="btn btn-ghost" type="button" mix={on('click', () => { secret = ''; handle.update() })}>I’ve saved it</button></div>}
      <ul class="step-list">{tokens.map((token) => <li key={token.id}><span>{token.name} <small class="mono">{new Date(token.created_at).toLocaleDateString()}</small></span><button class="btn btn-ghost" type="button" disabled={busy} mix={on('click', async () => {
        busy = true; error = ''; handle.update()
        try { await appRequest(routes.dashboard.tokens.revoke.href({ tokenId: token.id }), 'POST'); secret = ''; await load() }
        catch (e) { error = (e as Error).message }
        finally { busy = false; handle.update() }
      })}>Revoke</button></li>)}</ul>
      {tokens.length === 0 && <p class="mono">No active tokens.</p>}
    </>}
    {error && <p class="alert" role="alert">{error}</p>}
  </section>
})
