import { clientEntry, on, type Handle } from 'remix/component'
import type { WorkspaceCard, WorkspaceData } from '@trellix/contracts'
import { ArrowRightIcon, CircleCheckIcon, PinIcon } from '../../../ui/public/icons.tsx'
import { BoardTile } from '../boards/public/board-tile.tsx'

export const Workspace = clientEntry(import.meta.url, function Workspace(handle: Handle<{ workspace: WorkspaceData }>) {
  let view: 'recent' | 'pinned' = 'recent'
  let boardId = ''
  return () => {
    let { boards, recent, pinned } = handle.props.workspace
    let cards = (view === 'pinned' ? pinned : recent).filter(card => !boardId || card.boardId === boardId)
    let open = boards.reduce((n, b) => n + b.total - b.done, 0)
    let done = boards.reduce((n, b) => n + b.done, 0)
    return <div class="workspace-layout">
      <div class="workspace-main">
        <section class="workspace-section" aria-labelledby="workspace-boards">
          <div class="section-heading"><h2 id="workspace-boards">Your boards <span class="quiet-count">{boards.length}</span></h2><a href="/dashboard/boards">View all <ArrowRightIcon /></a></div>
          {boards.length ? <div class="workspace-boards">{boards.slice(0, 4).map((board, index) => <BoardTile key={board.id} board={board} index={index} compact />)}</div>
            : <div class="workspace-empty"><div class="empty-board-art" aria-hidden="true"><i /><i /><i /></div><h3>No boards yet</h3><p>A launch, a side project, the everyday stuff.<br />Give your next idea a place to go.</p><a class="btn btn-primary" href="/dashboard/boards/new">Create your first board <ArrowRightIcon /></a></div>}
        </section>
        <section class="workspace-section work-feed" aria-labelledby="workspace-cards">
          <div class="section-heading"><h2 id="workspace-cards">Pick up a card</h2><span class="feed-limit">{view === 'recent' ? 'Last 24 updated' : 'Last 12 pinned'}</span></div>
          <div class="work-feed-tools"><div class="work-tabs" aria-label="Workspace cards">
            <button type="button" aria-pressed={view === 'recent'} mix={on('click', () => { view = 'recent'; handle.update() })}>Recent</button>
            <button type="button" aria-pressed={view === 'pinned'} mix={on('click', () => { view = 'pinned'; handle.update() })}><PinIcon />Pinned <span>{pinned.length}</span></button>
          </div><select aria-label="Filter workspace by board" value={boardId} mix={on('change', e => { boardId = e.currentTarget.value; handle.update() })}><option value="">All boards</option>{boards.map(board => <option value={board.id}>{board.name}</option>)}</select></div>
          {cards.length ? <div class="work-list">{cards.map(card => <WorkRow key={card.id} card={card} />)}</div> : <div class="work-empty"><PinIcon /><h3>{view === 'pinned' ? 'Keep the good stuff close' : 'A fresh start'}</h3><p>{view === 'pinned' ? 'Pin a card from its details to find it here.' : 'Cards you create and update will appear here.'}</p></div>}
        </section>
      </div>
      <aside class="workspace-aside">
        <section class="workspace-note"><span class="eyebrow">A little perspective</span><h2>{open === 0 ? 'Room for your next idea.' : `${open} ${open === 1 ? 'card' : 'cards'}. One step at a time.`}</h2><p>{done > 0 ? `${done} ${done === 1 ? 'card' : 'cards'} already in the done pile. Keep that momentum going.` : 'Make it small. Make it clear. Move it forward.'}</p><a href="/dashboard/insights">See your progress <ArrowRightIcon /></a><div class="note-doodle" aria-hidden="true"><CircleCheckIcon /><span>little wins add up</span></div></section>
        <section class="pinned-shelf"><div class="section-heading"><h2><PinIcon />Within reach</h2></div>{pinned.length ? pinned.slice(0, 4).map(card => <a class="pinned-note" href={cardHref(card)} data-rmx-document ><span class="pinned-board"><i />{card.boardName}</span><strong>{card.title}</strong><span>{card.columnName}<ArrowRightIcon /></span></a>) : <p class="aside-empty">Pin the cards you come back to. They’ll stay right here.</p>}</section>
        <div class="workspace-shortcuts"><span><kbd>⌘ K</kbd> Find anything</span><span><kbd>B</kbd> New board</span><span><kbd>N</kbd> New card on a board</span></div>
      </aside>
    </div>
  }
})

function cardHref(card: WorkspaceCard) { return `/dashboard/cards/${encodeURIComponent(card.boardId)}/${encodeURIComponent(card.id)}` }
function WorkRow(handle: Handle<{ card: WorkspaceCard }>) {
  return () => {
    let { card } = handle.props
    return <a class="work-row" href={cardHref(card)} data-rmx-document >
      <span class="work-state" data-done={card.done ? '' : undefined}>{card.done ? <CircleCheckIcon /> : <span />}</span>
      <span class="work-content"><strong>{card.title}</strong><span class="work-context"><i />{card.boardName}<span>·</span>{card.columnName}{card.tags.slice(0, 2).map(tag => <span class="work-tag">#{tag}</span>)}</span></span>
      {card.priority !== 'normal' && <span class="card-badge" data-priority={card.priority}>{card.priority}</span>}
      <time dateTime={new Date(card.updatedAt).toISOString()} title={new Date(card.updatedAt).toISOString()}>{new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(card.updatedAt)}</time><ArrowRightIcon />
    </a>
  }
}
