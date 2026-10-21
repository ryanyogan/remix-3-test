import { createController } from 'remix/router'
import { createAccessToken, revokeAccessToken } from '@trellix/data/operations'
import { requireUser } from '../../../middleware/require-user.tsx'
import { routes } from '../../../routes.ts'
import { dataResponse, input, wantsJson } from '../data-response.ts'
import { renderAccount, type AccountContext } from './account.tsx'

function toAccount(context: AccountContext) {
  return {
    redirect: routes.dashboard.account.href(),
    rejected: (error: string, status: number) => renderAccount(context, { error, status }),
  }
}

export default createController(routes.dashboard.tokens, {
  middleware: requireUser(),
  actions: {
    create: (context) =>
      dataResponse(context, async (services) => {
        let token = await createAccessToken(services, await input(context))
        return wantsJson(context.request) ? token : renderAccount(context, { secret: token.token })
      }, toAccount(context)),
    revoke: (context) =>
      dataResponse(context, (services) => revokeAccessToken(services, context.params), toAccount(context)),
  },
})
