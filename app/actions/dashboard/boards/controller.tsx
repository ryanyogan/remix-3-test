import * as s from 'remix/data-schema'
import { redirect } from 'remix/response/redirect'
import { createController } from 'remix/router'

import { boardItems, boards } from '../../../data/tables.ts'
import { requireUser } from '../../../middleware/require-user.ts'
import { routes } from '../../../routes.ts'
import {
  createBoard,
  findOwnedBoard,
  listBoards,
  loadBoardData,
  upsertColumn,
  upsertItem,
} from './data.ts'
import { BoardPage, BoardsPage } from './pages.tsx'
import { newBoardForm, renameBoardForm, upsertColumnForm, upsertItemForm } from './schema.ts'

// Board mutations answer the enhanced board's fetch() calls with 204, and plain form posts
// with a redirect back to the board.
function mutated(request: Request, boardId: string) {
  if (request.headers.get('Accept')?.includes('application/json')) {
    return new Response(null, { status: 204 })
  }
  return redirect(routes.dashboard.boards.show.href({ boardId }), 303)
}

const notFound = () => new Response('Board not found', { status: 404 })
const badRequest = () => new Response('Bad request', { status: 400 })

export default createController(routes.dashboard.boards, {
  middleware: [requireUser()],
  actions: {
    async index(context) {
      let user = context.auth.identity
      return context.render(
        <BoardsPage user={user} boards={await summarizeBoards(context.db, user.id)} />,
      )
    },

    async create(context) {
      let user = context.auth.identity
      let parsed = s.parseSafe(newBoardForm, context.formData)
      if (!parsed.success) {
        let name = context.formData.get('name')
        let color = context.formData.get('color')
        let newBoard = {
          name: typeof name === 'string' ? name : '',
          color: typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color) ? color : '#9ec5f4',
          error: 'Enter a board name',
        }
        return context.render(
          <BoardsPage
            user={user}
            boards={await summarizeBoards(context.db, user.id)}
            newBoard={newBoard}
          />,
          { status: 400 },
        )
      }

      let boardId = await createBoard(context.db, user.id, parsed.value)
      return redirect(routes.dashboard.boards.show.href({ boardId }), 303)
    },

    async show(context) {
      let board = await findOwnedBoard(context.db, context.auth.identity.id, context.params.boardId)
      if (board === null) return notFound()

      return context.render(
        <BoardPage user={context.auth.identity} board={await loadBoardData(context.db, board)} />,
      )
    },

    async rename(context) {
      let board = await findOwnedBoard(context.db, context.auth.identity.id, context.params.boardId)
      if (board === null) return notFound()

      let parsed = s.parseSafe(renameBoardForm, context.formData)
      if (!parsed.success) return badRequest()

      await context.db.update(boards, board.id, { name: parsed.value.name })
      return mutated(context.request, board.id)
    },

    async destroy(context) {
      let board = await findOwnedBoard(context.db, context.auth.identity.id, context.params.boardId)
      if (board === null) return notFound()

      await context.db.delete(boards, board.id)
      if (context.request.headers.get('Accept')?.includes('application/json')) {
        return new Response(null, { status: 204 })
      }
      return redirect(routes.dashboard.boards.index.href(), 303)
    },

    async upsertColumn(context) {
      let board = await findOwnedBoard(context.db, context.auth.identity.id, context.params.boardId)
      if (board === null) return notFound()

      let parsed = s.parseSafe(upsertColumnForm, context.formData)
      if (!parsed.success) return badRequest()

      let { id = crypto.randomUUID(), name } = parsed.value
      if (!(await upsertColumn(context.db, board.id, { id, name }))) return notFound()
      return mutated(context.request, board.id)
    },

    async upsertItem(context) {
      let board = await findOwnedBoard(context.db, context.auth.identity.id, context.params.boardId)
      if (board === null) return notFound()

      let parsed = s.parseSafe(upsertItemForm, context.formData)
      if (!parsed.success) return badRequest()

      let { id = crypto.randomUUID(), ...values } = parsed.value
      if (!(await upsertItem(context.db, board.id, { id, ...values }))) return notFound()
      return mutated(context.request, board.id)
    },

    // Deleting a card that is already gone succeeds, so a delete can race a pending create.
    async deleteItem(context) {
      let board = await findOwnedBoard(context.db, context.auth.identity.id, context.params.boardId)
      if (board === null) return notFound()

      await context.db.deleteMany(boardItems, {
        where: { id: context.params.itemId, board_id: board.id },
      })
      return mutated(context.request, board.id)
    },
  },
})

async function summarizeBoards(db: Parameters<typeof listBoards>[0], userId: string) {
  let userBoards = await listBoards(db, userId)
  return Promise.all(
    userBoards.map(async (board) => ({
      id: board.id,
      name: board.name,
      color: board.color,
      cardCount: await db.count(boardItems, { where: { board_id: board.id } }),
    })),
  )
}
