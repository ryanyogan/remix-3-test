import { createController } from 'remix/router'
import { listAccessTokens, createAccessToken, revokeAccessToken } from '@trellix/data/operations'
import { routes } from '../../../routes.ts'
import { dataResponse, input } from '../data-response.ts'

export default createController(routes.dashboard.tokens, {
  actions: {
    index: (context) => dataResponse(context, (services) => listAccessTokens(services)),
    create: (context) =>
      dataResponse(context, async (services) =>
        createAccessToken(services, await input(context)),
      ),
    revoke: (context) =>
      dataResponse(context, (services) => revokeAccessToken(services, context.params)),
  },
})
