import type { Handle } from 'remix/component'
import { css } from 'remix/component'

import type { User } from '../../../data/tables.ts'
import type { Theme } from '../../../ui/theme.ts'
import { DashboardLayout } from '../layout.tsx'
import type { WorkspaceBoard } from '@trellix/contracts'
import type { BoardData } from './public/board-model.ts'
import { Board } from './public/board.tsx'
import { BoardTile } from './public/board-tile.tsx'
import { NewBoardButton, NewBoardForm } from './public/new-board-form.tsx'
import { routes } from '../../../routes.ts'
import { BoardSettings } from './public/board-settings.tsx'

interface BoardsPageProps {
  user: User
  theme?: Theme
  boards: WorkspaceBoard[]
}

export function BoardsPage(handle: Handle<BoardsPageProps>) {
  return () => {
    let { user, theme, boards } = handle.props
    let cards = boards.reduce((sum, board) => sum + board.total, 0)

    return (
      <DashboardLayout
        user={user}
        theme={theme}
        title="Boards"
        current="boards"
        actions={<NewBoardButton />}
        meta={
          <p class="mono" mix={css({ margin: 0 })}>
            {plural(boards.length, 'board')} · {plural(cards, 'card')}
          </p>
        }
      >


        {boards.length === 0 ? (
          <p mix={emptyStyle}>No boards yet. Create a board for your next project.</p>
        ) : (
          <div class="board-grid">
            {boards.map((board, index) => (
              <BoardTile
                key={board.id}
                board={board}
                index={index}
              />
            ))}
          </div>
        )}
      </DashboardLayout>
    )
  }
}

export function NewBoardPage(handle: Handle<{ user: User; theme?: Theme; name?: string; error?: string }>) {
  return () => <DashboardLayout user={handle.props.user} theme={handle.props.theme} title="Create a new board" current="boards" centered>
    <NewBoardForm name={handle.props.name} error={handle.props.error} />
  </DashboardLayout>
}

export function BoardPage(handle: Handle<{ user: User; theme?: Theme; board: BoardData; columnId?: string }>) {
  return () => {
    let { user, theme, board } = handle.props

    return (
      <DashboardLayout user={user} theme={theme} title={board.name} current="boards" bleed>
        <Board board={board} columnId={handle.props.columnId} user={{ id: user.id, name: user.name }} />
      </DashboardLayout>
    )
  }
}

type BoardToolsProps = { user: User; theme?: Theme; board: { id: string; name: string } }

export function BoardSettingsPage(handle: Handle<BoardToolsProps>) {
  return () => <DashboardLayout user={handle.props.user} theme={handle.props.theme} title="Board Settings" current="boards" home>
    <header class="board-tools-heading"><a href={routes.dashboard.boards.show.href({ boardId: handle.props.board.id })}>← {handle.props.board.name}</a><h1>Board Settings</h1></header>
    <BoardSettings board={handle.props.board} />
  </DashboardLayout>
}

export function BoardWebhooksPage(handle: Handle<BoardToolsProps>) {
  return () => <DashboardLayout user={handle.props.user} theme={handle.props.theme} title="Webhooks" current="boards" home>
    <header class="board-tools-heading"><a href={routes.dashboard.boards.show.href({ boardId: handle.props.board.id })}>← {handle.props.board.name}</a><h1>Webhooks</h1></header>
    <section class="board-settings-panel"><p>Webhooks notify another application when something happens in this board.</p><p>Webhook delivery isn’t available in Trellix yet. You can use the API to read and update this board.</p><a class="btn" href={routes.apiGuide.href()}>View API documentation</a></section>
  </DashboardLayout>
}

function plural(count: number, noun: string) {
  return `${count} ${count === 1 ? noun : `${noun}s`}`
}

const emptyStyle = css({ margin: 0, color: 'var(--ink-2)' })
