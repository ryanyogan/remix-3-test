import type { Handle } from 'remix/component'
import { css } from 'remix/component'

import type { User } from '../../../data/tables.ts'
import { routes } from '../../../routes.ts'
import { buttonStyle, errorStyle, fieldStyle } from '../../../ui/layout.tsx'
import { DashboardLayout } from '../layout.tsx'
import type { BoardData } from './public/board-model.ts'
import { Board } from './public/board.tsx'
import { BoardTile } from './public/board-tile.tsx'

interface BoardSummary {
  id: string
  name: string
  color: string
  cardCount: number
}

interface BoardsPageProps {
  user: User
  boards: BoardSummary[]
  newBoard?: { name: string; color: string; error: string }
}

export function BoardsPage(handle: Handle<BoardsPageProps>) {
  return () => {
    let { user, boards, newBoard } = handle.props

    return (
      <DashboardLayout user={user} title="Boards" current="boards">
        {/* A full-document submission: after the runtime's in-place POST + redirect navigation,
            Chromium cancels HTML5 drags on the new board until the next load. */}
        <form
          method="post"
          action={routes.dashboard.boards.create.href()}
          data-rmx-document
          mix={newBoardStyle}
        >
          <div mix={[fieldStyle, css({ flex: '1 1 220px' })]}>
            <label htmlFor="board-name">New board</label>
            <input
              id="board-name"
              name="name"
              required
              maxLength={100}
              autoComplete="off"
              placeholder="Board name"
              defaultValue={newBoard?.name}
              aria-invalid={newBoard ? true : undefined}
              aria-describedby={newBoard ? 'board-name-error' : undefined}
            />
          </div>
          <div mix={[fieldStyle, css({ flex: '0 0 auto' })]}>
            <label htmlFor="board-color">Color</label>
            <input
              id="board-color"
              name="color"
              type="color"
              defaultValue={newBoard?.color ?? '#9ec5f4'}
              mix={css({ height: '42px', width: '56px', padding: '4px' })}
            />
          </div>
          <button type="submit" mix={[buttonStyle, css({ alignSelf: 'flex-end' })]}>
            Create
          </button>
          {newBoard && (
            <p id="board-name-error" role="alert" mix={[errorStyle, css({ flexBasis: '100%' })]}>
              {newBoard.error}
            </p>
          )}
        </form>

        {boards.length === 0 ? (
          <p mix={css({ margin: 0, color: 'var(--text-tertiary)' })}>
            No boards yet. Create one above.
          </p>
        ) : (
          <ul mix={gridStyle}>
            {boards.map((board) => (
              <BoardTile key={board.id} {...board} />
            ))}
          </ul>
        )}
      </DashboardLayout>
    )
  }
}

export function BoardPage(handle: Handle<{ user: User; board: BoardData }>) {
  return () => {
    let { user, board } = handle.props

    return (
      <DashboardLayout user={user} title={board.name} current="boards" bleed>
        <Board board={board} />
      </DashboardLayout>
    )
  }
}

const newBoardStyle = css({
  display: 'flex',
  flexWrap: 'wrap',
  gap: '12px',
  padding: '20px',
  borderRadius: '16px',
  background: 'var(--surface-3)',
})

const gridStyle = css({
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
  gap: '16px',
})
