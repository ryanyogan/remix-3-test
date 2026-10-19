import { loadWorkspace } from '@trellix/data/workspace'
import * as s from 'remix/data-schema'
import type { Issue } from 'remix/data-schema'
import { DataTableValidationError } from 'remix/data-table'
import { createFileResponse } from 'remix/response/file'
import { redirect } from 'remix/response/redirect'
import { createController } from 'remix/router'

import { boardItemFiles, boardItems, boards } from '../../../data/tables.ts'
import { limits } from '../../../data/limits.ts'
import { requireUser } from '../../../middleware/require-user.ts'
import { routes } from '../../../routes.ts'
import { readTheme } from '../../../ui/theme.ts'
import {
  attachFile,
  createBoard,
  deleteColumn,
  findOwnedBoard,
  loadBoardData,
  removeStoredFiles,
  upsertColumn,
  upsertItem,
} from './data.ts'
import { BoardPage, BoardsPage, NewBoardPage, BoardSettingsPage, BoardWebhooksPage } from './pages.tsx'
import {
  newBoardForm,
  renameBoardForm,
  uploadFileForm,
  upsertColumnForm,
  upsertItemForm,
} from './schema.ts'

// Board mutations answer the enhanced board's fetch() calls with 204, and plain form posts
// with a redirect back to the board.
function mutated(request: Request, boardId: string) {
  if (wantsJson(request)) {
    return new Response(null, { status: 204 })
  }
  return redirect(routes.dashboard.boards.show.href({ boardId }), 303)
}

function wantsJson(request: Request) {
  return request.headers.get('Accept')?.includes('application/json') ?? false
}

// A rejected mutation: the enhanced board shows `error` inline; a plain form post gets text.
function invalid(request: Request, issues: readonly { message: string }[]) {
  let error = issues[0]?.message ?? 'That change could not be saved'
  if (wantsJson(request)) return Response.json({ error }, { status: 422 })
  return new Response(error, { status: 400 })
}

// Runs a write, turning table-level validation failures into a 422 for the board.
async function write(request: Request, run: () => Promise<Response>): Promise<Response> {
  try {
    return await run()
  } catch (error) {
    if (error instanceof DataTableValidationError) {
      return invalid(request, error.issues as Issue[])
    }
    throw error
  }
}

const notFound = () => new Response('Board not found', { status: 404 })

// Raster images may be shown inline as thumbnails. Everything else, SVG included since it can
// carry script, is served as a download.
const inlineTypes = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'])

export default createController(routes.dashboard.boards, {
  middleware: [requireUser()],
  actions: {
    async index(context) {
      if (new URL(context.request.url).searchParams.has('new')) return redirect(routes.dashboard.boards.new.href())
      let user = context.auth.identity
      let { boards: userBoards } = await loadWorkspace(context.db, user.id)
      return context.render(
        <BoardsPage user={user} theme={await readTheme(context.request)} boards={userBoards} />,
      )
    },

    async new(context) {
      return context.render(<NewBoardPage user={context.auth.identity} theme={await readTheme(context.request)} />)
    },

    async create(context) {
      let user = context.auth.identity
      let parsed = s.parseSafe(newBoardForm, context.formData)
      if (!parsed.success) {
        let name = context.formData.get('name')
        return context.render(
          <NewBoardPage user={user} theme={await readTheme(context.request)}
            name={typeof name === 'string' ? name : ''}
            error={parsed.issues[0]?.message ?? 'Enter a board name'} />,
          { status: 400 },
        )
      }

      let boardId = await createBoard(context.db, user.id, parsed.value)
      return redirect(routes.dashboard.boards.show.href({ boardId }), 303)
    },

    async show(context) {
      let cardId = new URL(context.request.url).searchParams.get('card')
      if (cardId) return redirect(routes.dashboard.cards.show.href({ boardId: context.params.boardId, cardId }))
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
      return context.render(<BoardSettingsPage user={context.auth.identity} theme={await readTheme(context.request)} board={board} />)
    },

    async webhooks(context) {
      let board = await findOwnedBoard(context.db, context.auth.identity.id, context.params.boardId)
      if (!board) return notFound()
      return context.render(<BoardWebhooksPage user={context.auth.identity} theme={await readTheme(context.request)} board={board} />)
    },

    async rename(context) {
      let board = await findOwnedBoard(context.db, context.auth.identity.id, context.params.boardId)
      if (board === null) return notFound()

      let parsed = s.parseSafe(renameBoardForm, context.formData)
      if (!parsed.success) return invalid(context.request, parsed.issues)

      return write(context.request, async () => {
        await context.db.update(boards, board.id, { name: parsed.value.name })
        return mutated(context.request, board.id)
      })
    },

    async destroy(context) {
      let board = await findOwnedBoard(context.db, context.auth.identity.id, context.params.boardId)
      if (board === null) return notFound()

      await removeStoredFiles(context.db, context.uploads, { board_id: board.id })
      await context.db.delete(boards, board.id)
      if (wantsJson(context.request)) {
        return new Response(null, { status: 204 })
      }
      return redirect(routes.dashboard.boards.index.href(), 303)
    },

    async upsertColumn(context) {
      let board = await findOwnedBoard(context.db, context.auth.identity.id, context.params.boardId)
      if (board === null) return notFound()

      let parsed = s.parseSafe(upsertColumnForm, context.formData)
      if (!parsed.success) return invalid(context.request, parsed.issues)

      let { id = crypto.randomUUID(), name } = parsed.value
      return write(context.request, async () => {
        if (!(await upsertColumn(context.db, board.id, { id, name }))) return notFound()
        return mutated(context.request, board.id)
      })
    },

    // Deleting a column that is already gone succeeds, so a delete can race a pending create.
    async deleteColumn(context) {
      let board = await findOwnedBoard(context.db, context.auth.identity.id, context.params.boardId)
      if (board === null) return notFound()

      await deleteColumn(context.db, context.uploads, board.id, context.params.columnId)
      return mutated(context.request, board.id)
    },

    async upsertItem(context) {
      let board = await findOwnedBoard(context.db, context.auth.identity.id, context.params.boardId)
      if (board === null) return notFound()

      let parsed = s.parseSafe(upsertItemForm, context.formData)
      if (!parsed.success) return invalid(context.request, parsed.issues)

      let { id = crypto.randomUUID(), ...values } = parsed.value
      return write(context.request, async () => {
        if (!(await upsertItem(context.db, board.id, { id, ...values }))) return notFound()
        return mutated(context.request, board.id)
      })
    },

    // Deleting a card that is already gone succeeds, so a delete can race a pending create.
    async deleteItem(context) {
      let board = await findOwnedBoard(context.db, context.auth.identity.id, context.params.boardId)
      if (board === null) return notFound()

      let item = await context.db.findOne(boardItems, {
        where: { id: context.params.itemId, board_id: board.id },
      })
      if (item) {
        await removeStoredFiles(context.db, context.uploads, { item_id: item.id })
        await context.db.delete(boardItems, item.id)
      }
      return mutated(context.request, board.id)
    },

    async uploadFile(context) {
      let board = await findOwnedBoard(context.db, context.auth.identity.id, context.params.boardId)
      if (board === null) return notFound()

      let parsed = s.parseSafe(uploadFileForm, context.formData)
      if (!parsed.success) return invalid(context.request, parsed.issues)

      let { id = crypto.randomUUID(), file } = parsed.value
      return write(context.request, async () => {
        let result = await attachFile(
          context.db,
          context.uploads,
          board.id,
          context.params.itemId,
          {
            id,
            file,
          },
        )
        if (result === 'missing') return new Response('Card not found', { status: 404 })
        if (result === 'full') {
          return invalid(context.request, [
            { message: `A card can hold up to ${limits.filesPerCard} files` },
          ])
        }
        return mutated(context.request, board.id)
      })
    },

    async file(context) {
      let board = await findOwnedBoard(context.db, context.auth.identity.id, context.params.boardId)
      if (board === null) return notFound()

      let row = await context.db.findOne(boardItemFiles, {
        where: { id: context.params.fileId, board_id: board.id },
      })
      let stored = row && (await context.uploads.get(row.id))
      if (!row || !stored) return new Response('File not found', { status: 404 })

      let response = await createFileResponse(stored, context.request, {
        cacheControl: 'private, max-age=3600',
      })
      let disposition = inlineTypes.has(row.type) ? 'inline' : 'attachment'
      response.headers.set(
        'Content-Disposition',
        `${disposition}; filename*=UTF-8''${encodeURIComponent(row.name)}`,
      )
      return response
    },

    async deleteFile(context) {
      let board = await findOwnedBoard(context.db, context.auth.identity.id, context.params.boardId)
      if (board === null) return notFound()

      let row = await context.db.findOne(boardItemFiles, {
        where: { id: context.params.fileId, board_id: board.id },
      })
      if (row) {
        await context.uploads.remove(row.id)
        await context.db.delete(boardItemFiles, row.id)
      }
      return mutated(context.request, board.id)
    },
  },
})
