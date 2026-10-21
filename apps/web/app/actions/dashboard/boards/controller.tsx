import * as operations from '@trellix/data/operations'
import { listBoards } from '@trellix/data/boards'
import { boardServices, cardServices } from '@trellix/data/operation-context'
import { OperationError } from '@trellix/data/operation-errors'
import { dataResponse, input, type FormReply } from '../data-response.ts'
import { loadWorkspace } from '@trellix/data/workspace'
import * as s from 'remix/data-schema'
import { createFileResponse } from 'remix/response/file'
import { redirect } from 'remix/response/redirect'
import { createController } from 'remix/router'

import { boardItemFiles } from '../../../data/tables.ts'
import { requireUser } from '../../../middleware/require-user.tsx'
import { routes } from '../../../routes.ts'
import { readTheme } from '../../../ui/theme.ts'
import { createBoard, findOwnedBoard, loadBoardData } from './data.ts'
import {
  BoardPage,
  BoardsPage,
  NewBoardPage,
  BoardSettingsPage,
  BoardWebhooksPage,
} from './pages.tsx'
import { newBoardForm } from './schema.ts'

// Board writes answer the enhanced board's fetch() calls with JSON, and plain form posts with
// a redirect back to the board. Both go through the shared operations, which validate once.
const toBoard = (boardId: string): FormReply => ({
  redirect: routes.dashboard.boards.show.href({ boardId }),
})

// Deleting something that is already gone succeeds, so a delete can race a pending create.
function unlessGone(error: unknown) {
  if (error instanceof OperationError && error.status === 404) return
  throw error
}

const notFound = () => new Response('Board not found', { status: 404 })

// Raster images may be shown inline as thumbnails. Everything else, SVG included since it can
// carry script, is served as a download.
const inlineTypes = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'])

export default createController(routes.dashboard.boards, {
  middleware: requireUser(),
  actions: {
    options: (context) =>
      dataResponse(context, (services) => listBoards(services.db, services.user.id)),
    data: (context) =>
      dataResponse(context, async (services) =>
        loadBoardData(services.db, (await boardServices(services, context.params.boardId)).board),
      ),
    watch: (context) =>
      dataResponse(context, async (services) =>
        operations.watchBoard(
          await boardServices(services, context.params.boardId),
          await input(context),
        ),
      ),
    moveColumn: (context) =>
      dataResponse(context, async (services) =>
        operations.reorderBoardColumn(
          await boardServices(services, context.params.boardId),
          context.params,
          await input(context),
        ),
      ),
    async index(context) {
      if (new URL(context.request.url).searchParams.has('new'))
        return redirect(routes.dashboard.boards.new.href())
      let user = context.auth.identity
      let { boards: userBoards } = await loadWorkspace(context.db, user.id)
      return context.render(
        <BoardsPage user={user} theme={await readTheme(context.request)} boards={userBoards} />,
      )
    },

    async new(context) {
      return context.render(
        <NewBoardPage user={context.auth.identity} theme={await readTheme(context.request)} />,
      )
    },

    async create(context) {
      let user = context.auth.identity
      let parsed = s.parseSafe(newBoardForm, context.formData)
      if (!parsed.success) {
        let name = context.formData.get('name')
        return context.render(
          <NewBoardPage
            user={user}
            theme={await readTheme(context.request)}
            name={typeof name === 'string' ? name : ''}
            error={parsed.issues[0]?.message ?? 'Enter a board name'}
          />,
          { status: 400 },
        )
      }

      let boardId = await createBoard(context.db, user.id, parsed.value)
      return redirect(routes.dashboard.boards.show.href({ boardId }), 303)
    },

    async show(context) {
      let cardId = new URL(context.request.url).searchParams.get('card')
      if (cardId)
        return redirect(
          routes.dashboard.cards.show.href({ boardId: context.params.boardId, cardId }),
        )
      let board = await findOwnedBoard(context.db, context.auth.identity.id, context.params.boardId)
      if (board === null) return notFound()

      return context.render(
        <BoardPage
          user={context.auth.identity}
          theme={await readTheme(context.request)}
          columnId={new URL(context.request.url).searchParams.get('column') ?? undefined}
          board={await loadBoardData(context.db, board)}
        />,
      )
    },

    async edit(context) {
      let board = await findOwnedBoard(context.db, context.auth.identity.id, context.params.boardId)
      if (!board) return notFound()
      return context.render(
        <BoardSettingsPage
          user={context.auth.identity}
          theme={await readTheme(context.request)}
          board={board}
        />,
      )
    },

    async webhooks(context) {
      let board = await findOwnedBoard(context.db, context.auth.identity.id, context.params.boardId)
      if (!board) return notFound()
      return context.render(
        <BoardWebhooksPage
          user={context.auth.identity}
          theme={await readTheme(context.request)}
          board={board}
        />,
      )
    },

    rename: (context) =>
      dataResponse(
        context,
        async (services) =>
          operations.renameBoard(
            await boardServices(services, context.params.boardId),
            await input(context),
          ),
        toBoard(context.params.boardId),
      ),
    destroy: (context) =>
      dataResponse(
        context,
        async (services) =>
          operations.removeBoard(await boardServices(services, context.params.boardId)),
        { redirect: routes.dashboard.boards.index.href() },
      ),
    upsertColumn: (context) =>
      dataResponse(
        context,
        async (services) =>
          operations.createBoardColumn(
            await boardServices(services, context.params.boardId),
            await input(context),
          ),
        toBoard(context.params.boardId),
      ),
    // A column that is already gone counts as deleted.
    deleteColumn: (context) =>
      dataResponse(
        context,
        async (services) =>
          operations.removeBoardColumn(
            await boardServices(services, context.params.boardId),
            context.params,
          ),
        toBoard(context.params.boardId),
      ),
    upsertItem: (context) =>
      dataResponse(
        context,
        async (services) =>
          operations.createBoardCard(
            await boardServices(services, context.params.boardId),
            await input(context, { position: 'number' }),
          ),
        toBoard(context.params.boardId),
      ),
    deleteItem: (context) =>
      dataResponse(
        context,
        async (services) => {
          let { boardId, itemId } = context.params
          let board = await boardServices(services, boardId)
          let card = await cardServices(board, boardId, itemId).catch(unlessGone)
          if (card) await operations.removeBoardCard(card, { cardId: itemId })
        },
        toBoard(context.params.boardId),
      ),
    uploadFile: (context) =>
      dataResponse(
        context,
        async (services) => {
          let { boardId, itemId } = context.params
          await operations.uploadCardFile(
            await cardServices(services, boardId, itemId),
            { cardId: itemId },
            context.formData,
          )
        },
        toBoard(context.params.boardId),
      ),
    deleteFile: (context) =>
      dataResponse(
        context,
        async (services) => {
          let board = await boardServices(services, context.params.boardId)
          await operations.removeBoardFile(board, context.params).catch(unlessGone)
        },
        toBoard(context.params.boardId),
      ),

    async file(context) {
      let board = await findOwnedBoard(context.db, context.auth.identity.id, context.params.boardId)
      if (board === null) return notFound()

      let row = await context.db.findOne(boardItemFiles, {
        where: { id: context.params.fileId, board_id: board.id },
      })
      let stored = row && (await context.uploads.get(row.id))
      if (!row || !stored) return new Response('File not found', { status: 404 })

      let response = await createFileResponse(stored, context.request, {
        cacheControl: 'private, no-store',
      })
      response.headers.set('X-Content-Type-Options', 'nosniff')
      let disposition = inlineTypes.has(row.type) ? 'inline' : 'attachment'
      response.headers.set(
        'Content-Disposition',
        `${disposition}; filename*=UTF-8''${encodeURIComponent(row.name)}`,
      )
      return response
    },
  },
})
