import * as operations from '@trellix/data/operations'
import { boardServices, cardServices } from '@trellix/data/operation-context'
import { OperationError } from '@trellix/data/operation-errors'
import { dataResponse, input, downloadResponse, type FormReply } from '../data-response.ts'
import { webCard } from './web-card.ts'
import { createController } from 'remix/router'
import type { AppContext } from '../../../router.ts'
import type { User } from '../../../data/tables.ts'
import { loadNavigation } from '@trellix/data/activity'
import { findOwnedBoard, loadBoardColumns } from '@trellix/data/boards'
import { loadCard } from '@trellix/data/cards'
import { requireUser } from '../../../middleware/require-user.tsx'
import { readTheme } from '../../../ui/theme.ts'
import { routes } from '../../../routes.ts'
import { DashboardLayout } from '../layout.tsx'
import { CardPage } from './public/card-page.tsx'

// What the page helpers need from an action's context, once requireUser() has signed someone in.
type PageContext = Pick<AppContext, 'db' | 'request' | 'formData' | 'render'> & {
  auth: { identity: User }
}
type CardContext = PageContext & { params: { boardId: string; cardId: string } }

// Without JavaScript the card page's forms post here and come back to the card, or to the page
// again with the reason a write was rejected.
function toCard(context: CardContext): FormReply {
  return {
    redirect: () => {
      // Moving the card to another board changes its address.
      let boardId = context.formData.get('boardId')
      return routes.dashboard.cards.show.href({
        boardId: typeof boardId === 'string' && boardId ? boardId : context.params.boardId,
        cardId: context.params.cardId,
      })
    },
    rejected: (error, status) => renderCard(context, { error, status }),
  }
}

async function renderCard(
  context: CardContext,
  { error, status = 200 }: { error?: string; status?: number } = {},
) {
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
        error={error}
      />
    </DashboardLayout>,
    { status },
  )
}

async function renderNewCard(
  context: PageContext,
  options: { boardId?: string; columnId?: string; title?: string; error?: string; status?: number },
) {
  let user = context.auth.identity
  let navigation = await loadNavigation(context.db, user.id)
  let selected = options.boardId
    ? navigation.boards.find((b) => b.id === options.boardId)
    : navigation.boards[0]
  if (options.boardId && !selected) return new Response('Board not found', { status: 404 })
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
        initialColumn={options.columnId}
        initialTitle={options.title}
        error={options.error}
        board={board ? { id: board.id, name: board.name, columns: await loadBoardColumns(context.db, board.id) } : undefined}
      />
    </DashboardLayout>,
    { status: options.status ?? 200 },
  )
}

function text(formData: FormData, name: string) {
  let value = formData.get(name)
  return typeof value === 'string' ? value : undefined
}

export default createController(routes.dashboard.cards, {
  middleware: requireUser(),
  actions: {
    data: (context) =>
      dataResponse(context, async (services) => {
        let { board } = await boardServices(services, context.params.boardId)
        let card = await loadCard(services.db, board.id, context.params.cardId)
        if (!card) throw new OperationError(404, { message: 'Card not found' })
        return webCard(card)
      }),
    create: (context) =>
      dataResponse(
        context,
        async (services) =>
          operations.createBoardCard(
            await boardServices(services, context.params.boardId),
            await input(context, { tags: 'list', assigneeId: 'nullable' }),
          ),
        {
          // "Create and add another" opens a fresh draft on the same board.
          redirect: context.formData.has('another')
            ? `${routes.dashboard.cards.new.href()}?board=${context.params.boardId}`
            : routes.dashboard.boards.show.href({ boardId: context.params.boardId }),
          rejected: (error, status) =>
            renderNewCard(context, {
              boardId: context.params.boardId,
              columnId: text(context.formData, 'columnId'),
              title: text(context.formData, 'title'),
              error,
              status,
            }),
        },
      ),
    update: (context) =>
      dataResponse(
        context,
        async (services) =>
          operations.updateBoardCard(
            await cardServices(services, context.params.boardId, context.params.cardId),
            context.params,
            await input(context, {
              pinned: 'boolean',
              tags: 'list',
              assigneeId: 'nullable',
              position: 'number',
            }),
          ),
        toCard(context),
      ),
    destroy: (context) =>
      dataResponse(
        context,
        async (services) =>
          operations.removeBoardCard(
            await cardServices(services, context.params.boardId, context.params.cardId),
            context.params,
          ),
        { redirect: routes.dashboard.boards.show.href({ boardId: context.params.boardId }) },
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
      dataResponse(
        context,
        async (services) =>
          operations.setCardCover(
            await cardServices(services, context.params.boardId, context.params.cardId),
            context.formData,
          ),
        toCard(context),
      ),
    removeCover: (context) =>
      dataResponse(
        context,
        async (services) =>
          operations.removeCardCover(
            await cardServices(services, context.params.boardId, context.params.cardId),
          ),
        toCard(context),
      ),
    uploadFile: (context) =>
      dataResponse(
        context,
        async (services) =>
          operations.uploadCardFile(
            await cardServices(services, context.params.boardId, context.params.cardId),
            context.params,
            context.formData,
          ),
        toCard(context),
      ),
    addStep: (context) =>
      dataResponse(
        context,
        async (services) =>
          operations.createCardStep(
            await cardServices(services, context.params.boardId, context.params.cardId),
            context.params,
            await input(context),
          ),
        toCard(context),
      ),
    updateStep: (context) =>
      dataResponse(
        context,
        async (services) =>
          operations.updateCardStep(
            await cardServices(services, context.params.boardId, context.params.cardId),
            context.params,
            await input(context, { completed: 'boolean' }),
          ),
        toCard(context),
      ),
    removeStep: (context) =>
      dataResponse(
        context,
        async (services) =>
          operations.removeCardStep(
            await cardServices(services, context.params.boardId, context.params.cardId),
            context.params,
          ),
        toCard(context),
      ),
    addComment: (context) =>
      dataResponse(
        context,
        async (services) =>
          operations.createCardComment(
            await cardServices(services, context.params.boardId, context.params.cardId),
            context.params,
            await input(context),
          ),
        toCard(context),
      ),
    removeComment: (context) =>
      dataResponse(
        context,
        async (services) =>
          operations.removeCardComment(
            await cardServices(services, context.params.boardId, context.params.cardId),
            context.params,
          ),
        toCard(context),
      ),

    new(context) {
      let params = new URL(context.request.url).searchParams
      return renderNewCard(context, {
        boardId: params.get('board') ?? undefined,
        columnId: params.get('column') ?? undefined,
      })
    },
    show: (context) => renderCard(context),
  },
})
