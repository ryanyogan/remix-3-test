import * as operations from '@trellix/data/operations'
import { boardServices, cardServices } from '@trellix/data/operation-context'
import { OperationError } from '@trellix/data/operation-errors'
import { dataResponse, input, downloadResponse } from '../data-response.ts'
import { webCard } from './web-card.ts'
import { createController } from 'remix/router'
import { loadNavigation } from '@trellix/data/activity'
import { findOwnedBoard, loadBoardColumns } from '@trellix/data/boards'
import { loadCard } from '@trellix/data/cards'
import { requireUser } from '../../../middleware/require-user.tsx'
import { readTheme } from '../../../ui/theme.ts'
import { routes } from '../../../routes.ts'
import { DashboardLayout } from '../layout.tsx'
import { CardPage } from './public/card-page.tsx'

export default createController(routes.dashboard.cards, {
  middleware: [requireUser()],
  actions: {
    data: (context) =>
      dataResponse(context, async (services) => {
        let { board } = await boardServices(services, context.params.boardId)
        let card = await loadCard(services.db, board.id, context.params.cardId)
        if (!card) throw new OperationError(404, { message: 'Card not found' })
        return webCard(card)
      }),
    create: (context) =>
      dataResponse(context, async (services) =>
        operations.createBoardCard(
          await boardServices(services, context.params.boardId),
          await input(context.request),
        ),
      ),
    update: (context) =>
      dataResponse(context, async (services) =>
        operations.updateBoardCard(
          await cardServices(services, context.params.boardId, context.params.cardId),
          context.params,
          await input(context.request),
        ),
      ),
    destroy: (context) =>
      dataResponse(context, async (services) =>
        operations.removeBoardCard(
          await cardServices(services, context.params.boardId, context.params.cardId),
          context.params,
        ),
      ),
    cover: (context) =>
      dataResponse(context, async (services) =>
        downloadResponse(
          context.request,
          await operations.readCardCover(
            await cardServices(services, context.params.boardId, context.params.cardId),
          ),
        ),
      ),
    setCover: (context) =>
      dataResponse(context, async (services) =>
        operations.setCardCover(
          await cardServices(services, context.params.boardId, context.params.cardId),
          context.formData,
        ),
      ),
    removeCover: (context) =>
      dataResponse(context, async (services) =>
        operations.removeCardCover(
          await cardServices(services, context.params.boardId, context.params.cardId),
        ),
      ),
    uploadFile: (context) =>
      dataResponse(context, async (services) =>
        operations.uploadCardFile(
          await cardServices(services, context.params.boardId, context.params.cardId),
          context.params,
          context.formData,
        ),
      ),
    addStep: (context) =>
      dataResponse(context, async (services) =>
        operations.createCardStep(
          await cardServices(services, context.params.boardId, context.params.cardId),
          context.params,
          await input(context.request),
        ),
      ),
    updateStep: (context) =>
      dataResponse(context, async (services) =>
        operations.updateCardStep(
          await cardServices(services, context.params.boardId, context.params.cardId),
          context.params,
          await input(context.request),
        ),
      ),
    removeStep: (context) =>
      dataResponse(context, async (services) =>
        operations.removeCardStep(
          await cardServices(services, context.params.boardId, context.params.cardId),
          context.params,
        ),
      ),
    addComment: (context) =>
      dataResponse(context, async (services) =>
        operations.createCardComment(
          await cardServices(services, context.params.boardId, context.params.cardId),
          context.params,
          await input(context.request),
        ),
      ),
    removeComment: (context) =>
      dataResponse(context, async (services) =>
        operations.removeCardComment(
          await cardServices(services, context.params.boardId, context.params.cardId),
          context.params,
        ),
      ),

    async new(context) {
      let user = context.auth.identity
      let navigation = await loadNavigation(context.db, user.id)
      let params = new URL(context.request.url).searchParams
      let requested = params.get('board')
      let selected = requested
        ? navigation.boards.find((b) => b.id === requested)
        : navigation.boards[0]
      if (requested && !selected) return new Response('Board not found', { status: 404 })
      let board = selected && (await findOwnedBoard(context.db, user.id, selected.id))
      return context.render(
        <DashboardLayout
          user={user}
          theme={await readTheme(context.request)}
          title="Add a card"
          current="boards"
          navigation={navigation}
          card
        >
          <CardPage
            user={{ id: user.id, name: user.name }}
            boards={navigation.boards}
            tags={navigation.tags}
            initialColumn={params.get('column') ?? undefined}
            board={board ? { id: board.id, name: board.name, columns: await loadBoardColumns(context.db, board.id) } : undefined}
          />
        </DashboardLayout>,
      )
    },
    async show(context) {
      let user = context.auth.identity
      let board = await findOwnedBoard(context.db, user.id, context.params.boardId)
      if (!board) return new Response('Card not found', { status: 404 })
      let [detail, navigation, columns, theme] = await Promise.all([
        loadCard(context.db, board.id, context.params.cardId),
        loadNavigation(context.db, user.id),
        loadBoardColumns(context.db, board.id),
        readTheme(context.request),
      ])
      if (!detail) return new Response('Card not found', { status: 404 })
      return context.render(
        <DashboardLayout
          user={user}
          theme={theme}
          navigation={navigation}
          title={detail.title}
          current="boards"
          card
        >
          <CardPage
            user={{ id: user.id, name: user.name }}
            board={{ id: board.id, name: board.name, columns }}
            detail={webCard(detail)}
            boards={navigation.boards}
            tags={navigation.tags}
          />
        </DashboardLayout>,
      )
    },
  },
})
