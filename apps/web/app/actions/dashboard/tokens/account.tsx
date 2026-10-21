import { listAccessTokens } from '@trellix/data/operations'
import type { AppContext } from '../../../router.ts'
import type { User } from '../../../data/tables.ts'
import { readTheme } from '../../../ui/theme.ts'
import { AccountPage } from '../pages.tsx'
import type { AccessToken } from '../public/api-tokens.tsx'

export type AccountContext = Pick<AppContext, 'db' | 'uploads' | 'request' | 'render'> & {
  auth: { identity: User }
}

// The account page, also the answer to a token form posted without JavaScript: it shows a new
// token's secret (only ever sent once, so it cannot survive a redirect) or why a post failed.
export async function renderAccount(
  context: AccountContext,
  { secret, error, status = 200 }: { secret?: string; error?: string; status?: number } = {},
) {
  let user = context.auth.identity
  let [rows = [], theme] = await Promise.all([
    listAccessTokens({ db: context.db, uploads: context.uploads, user }),
    readTheme(context.request),
  ])
  let tokens: AccessToken[] = rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    created_at: Number(row.created_at),
  }))
  return context.render(
    <AccountPage user={user} theme={theme} tokens={tokens} secret={secret} error={error} />,
    { status },
  )
}
