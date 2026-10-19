import { clientEntry, css, on, ref } from 'remix/component'
import type { Handle } from 'remix/component'

import { limits } from '../../../../data/limits.ts'
import { routes } from '../../../../routes.ts'
import {
  PinIcon,
  ArrowRightIcon,
  CircleCheckIcon,
  PaperclipIcon,
  PlusIcon,
  TrashIcon,
  XIcon,
} from '../../../../ui/public/icons.tsx'
import {
  appendPosition,
  applyMutations,
  BoardStore,
  CARD_MIME_TYPE,
  dropPosition,
  formatBytes,
  type BoardData,
  type FileData,
  type ItemData,
} from './board-model.ts'
import { appRequest } from '../../public/app-request.ts'
import { glide, leave } from './motion.ts'
import { BoardFilters, ColumnMenu, defaultFilters, matchesFilters } from './board-controls.tsx'

// A port of Trellix (github.com/remix-run/example-trellix). The server renders the board;
// in the browser every edit renders immediately from BoardStore while the request runs, then
// the page reloads in place to pick up the saved data.
//
// Motion is mostly the theme's CSS, driven by attributes: data-new (created here, so no entrance
// stagger), data-dragging, data-drop-target, and data-landed (just moved; in the last column this
// stamps the done check). Deletes and reflows use @remix-run/ui/animation.
export const Board = clientEntry(
  import.meta.url,
  function Board(handle: Handle<{ board: BoardData; columnId?: string; user: { id: string; name: string } }>) {
    let refreshed: BoardData | undefined
    let refreshVersion = 0
    let store = new BoardStore(handle.props.board.id, async () => {
      let version = ++refreshVersion
      try {
        let board = await appRequest<BoardData>(routes.dashboard.boards.data.href({ boardId: handle.props.board.id }))
        if (version !== refreshVersion || handle.signal.aborted) return
        refreshed = board
        store.reloaded()
        handle.update()
      } catch { store.reject('Could not refresh the board. Reload the page to see the latest changes.') }
    })
    let watching = handle.props.board.watching !== false
    let watchPending = false
    let notNowCreation: Promise<string> | undefined
    let filters = defaultFilters()
    let search: HTMLInputElement | undefined
    let scroller: HTMLElement | undefined
    let fresh = new Set<string>()
    let landed = new Set<string>()

    store.addEventListener('change', () => handle.update(), { signal: handle.signal })
    handle.frame.addEventListener('reloadComplete', () => { refreshed = undefined; store.reloaded() }, {
      signal: handle.signal,
    })

    // While a card is dragged near (or past) the left or right edge of the lanes, scroll them
    // sideways, and near the top or bottom of a lane's cards, scroll that lane. Faster the
    // closer the pointer gets. Browsers do little of this for scrolling elements, so the board
    // drives it from the drag's pointer position.
    let dragX: number | null = null
    let dragY = 0
    let dragList: HTMLElement | null = null
    let lastDragOver = 0
    let lastFrame = 0
    let frame = 0

    function autoScroll(now: number) {
      frame = 0
      // Time-based, so the speed holds up when frames are slow or throttled.
      let elapsed = Math.min(now - (lastFrame || now), 50)
      lastFrame = now
      // dragover keeps firing while the pointer rests; silence means the drag left the window.
      if (!scroller || dragX === null || performance.now() - lastDragOver > 250) {
        stopAutoScroll()
        return
      }
      // Up to 1.2px per millisecond (about 20px a frame at 60fps) at the very edge.
      let rect = scroller.getBoundingClientRect()
      let x = edgeSpeed(dragX, rect.left, rect.right, Math.min(120, rect.width / 4))
      if (x !== 0) scroller.scrollLeft += Math.round(x * 1.2 * elapsed)
      if (dragList) {
        let list = dragList.getBoundingClientRect()
        let y = edgeSpeed(dragY, list.top, list.bottom, Math.min(64, list.height / 4))
        if (y !== 0) dragList.scrollTop += Math.round(y * 1.2 * elapsed)
      }
      frame = requestAnimationFrame(autoScroll)
    }

    function stopAutoScroll() {
      dragX = null
      dragList = null
      lastFrame = 0
      if (frame) cancelAnimationFrame(frame)
      frame = 0
      // Snapping (on phones) would fight the scrolling, so it is off for the drag.
      scroller?.removeAttribute('data-autoscroll')
    }

    if (typeof document !== 'undefined') {
      document.addEventListener('keydown', (event) => {
        if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return
        if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable], dialog, [popover]')) return
        if (event.key === '/' || event.key.toLowerCase() === 'f') { event.preventDefault(); search?.focus() }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          let lane = event.target instanceof Element ? event.target.closest('.lane') : null
          let links = [...(lane ?? document).querySelectorAll<HTMLAnchorElement>('.lane:not([data-collapsed]) .card-open')].filter(link => link.getClientRects().length)
          let index = links.indexOf(document.activeElement as HTMLAnchorElement)
          let next = links[index < 0 ? 0 : Math.max(0, Math.min(links.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))]
          if (next) { event.preventDefault(); next.focus(); next.scrollIntoView({ block: 'nearest' }) }
        }
      }, { signal: handle.signal })
      document.addEventListener(
        'dragover',
        (event) => {
          if (!event.dataTransfer?.types.includes(CARD_MIME_TYPE)) return
          dragX = event.clientX
          dragY = event.clientY
          dragList =
            event.target instanceof Element
              ? event.target.closest('.lane')?.querySelector<HTMLElement>('.lane-cards') ?? null
              : null
          lastDragOver = performance.now()
          scroller?.setAttribute('data-autoscroll', '')
          if (!frame) frame = requestAnimationFrame(autoScroll)
        },
        { signal: handle.signal },
      )
      for (let type of ['drop', 'dragend'] as const) {
        document.addEventListener(type, stopAutoScroll, { capture: true, signal: handle.signal })
      }
      handle.signal.addEventListener('abort', stopAutoScroll)
    }

    function scrollToEnd() {
      handle.queueTask(() => {
        if (scroller) scroller.scrollLeft = scroller.scrollWidth
      })
    }

    let cards: CardActions = {
      create(columnId, title, position) {
        filters = defaultFilters()
        let id = crypto.randomUUID()
        fresh.add(id)
        store.submit({ type: 'upsertItem', id, columnId, title, position })
      },
      move(card, columnId, position) {
        if (columnId === `not-now-${handle.props.board.id}` && !(refreshed ?? handle.props.board).columns.some(c => c.id === columnId)) {
          notNowCreation ??= appRequest<{ id: string }>(routes.dashboard.boards.upsertColumn.href({ boardId: handle.props.board.id }), 'POST', { name: 'Not Now' }).then(result => result.id)
          void notNowCreation.then(id => {
            store.submit({ type: 'upsertColumn', id, name: 'Not Now' })
            store.submit({ ...card, type: 'upsertItem', columnId: id, position })
          }).catch(error => { notNowCreation = undefined; store.reject(error.message) })
          return
        }
        store.submit({ ...card, type: 'upsertItem', columnId, position })
        landed.add(card.id)
        setTimeout(() => {
          landed.delete(card.id)
          handle.update()
        }, 1000)
      },
      open(id) {
        void store.whenItemSettled(id).then(() => {
          location.assign(routes.dashboard.cards.show.href({ boardId: handle.props.board.id, cardId: id }))
        }).catch(() => store.reject('Save the card before opening it.'))
      },
      isNew: (id) => fresh.has(id),
      hasLanded: (id) => landed.has(id),
    }

    return () => {
      let board = refreshed ?? handle.props.board
      let view = applyMutations(board, store.mutations)
      let matching = (item: ItemData) => matchesFilters(item, filters, { ...board, columns: view.columns }, handle.props.user.id)
      let sortItems = (items: ItemData[]) => [...items].sort((a, b) => filters.sort === 'oldest' ? (a.createdAt ?? 0) - (b.createdAt ?? 0) : filters.sort === 'newest' ? (b.createdAt ?? 0) - (a.createdAt ?? 0) : (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
      let notNow = view.columns.find(column => column.name.toLowerCase() === 'not now')
      let columns = view.columns.filter(column => column !== notNow)
      let first = columns[0]
      let deferred = notNow ?? { id: `not-now-${board.id}`, name: 'Not Now', items: [], position: 0 }
      let arranged = [deferred, ...columns]
      let focused = arranged.find(column => column.id === handle.props.columnId)
      let tools = <div class="board-tools-card">
        <a class="add-card" href={`${routes.dashboard.cards.new.href()}?board=${encodeURIComponent(board.id)}${first ? `&column=${encodeURIComponent(first.id)}` : ''}`} data-rmx-document>Add a card <kbd>C</kbd></a>
        <div class="watching-title"><span>{watching ? 'Watching for new cards' : 'Watch for new cards'}</span></div>
        <div class="board-watchers">{watching ? <span class="board-avatar" title={handle.props.user.name}>{initials(handle.props.user.name)}</span> : <span class="watching-empty">Get new cards in your notifications</span>}</div>
        <button type="button" class="board-watch-toggle" aria-pressed={watching} disabled={watchPending} mix={on('click', async () => {
          watchPending = true; handle.update()
          try { await appRequest(routes.dashboard.boards.watch.href({ boardId: board.id }), 'POST', { watching: !watching }); watching = !watching }
          catch (error) { store.reject(error instanceof Error ? error.message : 'Could not update watching') }
          finally { watchPending = false; handle.update() }
        })}><BoardGlyph name={watching ? 'bell-off' : 'bell'} />{watching ? 'Stop watching' : 'Start watching'}</button>
      </div>

      return (
        <div class={focused ? 'board board-column-view' : 'board'}>
          <header key="board-header" class="board-heading">
            <div class="board-title-row">
              <a class="board-round-button" href={routes.dashboard.boards.webhooks.href({ boardId: board.id })} data-rmx-document title="Webhooks" aria-label="Webhooks"><BoardGlyph name="world" /></a>
              <h1 class="board-title"><span>{view.name}</span></h1>
              <a class="board-round-button" href={routes.dashboard.boards.edit.href({ boardId: board.id })} data-rmx-document title={`Settings for ${view.name}`} aria-label={`Settings for ${view.name}`}><BoardGlyph name="settings" /></a>
            </div>
            <BoardFilters board={board} user={handle.props.user} filters={filters} onChange={value => { filters = value; handle.update() }} searchRef={node => { search = node }} />
            {focused && <a class="board-back-link" href={routes.dashboard.boards.show.href({ boardId: board.id })} data-rmx-document>← Back to board</a>}
            {store.error && (
              <p key="alert" role="alert" class="alert">
                <span>{store.error}</span>
                <button
                  type="button"
                  class="btn btn-ghost"
                  mix={on('click', () => store.dismissError())}
                >
                  Dismiss
                </button>
              </p>
            )}
          </header>

          <div class="board-mobile-tools">{tools}</div>
          <div key="board-lanes" class="lanes" mix={ref((node) => (scroller = node))}>
            {arranged.map((column, index) => {
              if (focused && focused.id !== column.id) return null
              let next = arranged[index + 1]
              return (
                <Column
                  key={column.id}
                  boardId={board.id}
                  boardName={view.name}
                  author={handle.props.user.name}
                  maybe={column.id === first?.id}
                  notNow={column.id === deferred.id}
                  tools={column.id === first?.id ? tools : undefined}
                  columnId={column.id}
                  name={column.name}
                  color={column.color ?? 'yellow'}
                  items={sortItems(column.items.filter(matching))}
                  maximized={!!focused}
                  canLeft={index > 2}
                  canRight={index < arranged.length - 2}
                  allItems={column.items}
                  index={index}
                  last={index === arranged.length - 1}
                  next={next && { id: next.id, name: next.name, position: appendPosition(next.items) }}
                  store={store}
                  cards={cards}
                />
              )
            })}
            {!focused && <NewColumn
              boardId={board.id}
              index={view.columns.length}
              editInitially={board.columns.length === 0}
              store={store}
              onAdd={scrollToEnd}
            />}
          </div>

        </div>
      )
    }
  },
)

// How fast to scroll toward an edge, from -1 to 1: zero outside the edge zones, full speed at
// or past the edge.
function edgeSpeed(at: number, start: number, end: number, zone: number) {
  if (at < start + zone) return -(1 - Math.max((at - start) / zone, 0))
  if (at > end - zone) return 1 - Math.max((end - at) / zone, 0)
  return 0
}

function plural(count: number, noun: string) {
  return `${count} ${count === 1 ? noun : `${noun}s`}`
}

// Card creates and moves go through the board, which remembers them for data-new/data-landed.
interface CardActions {
  create(columnId: string, title: string, position: number): void
  move(card: { id: string; title: string }, columnId: string, position: number): void
  open(id: string): void
  isNew(id: string): boolean
  hasLanded(id: string): boolean
}

// Where the → button sends a card: the next column, appended at its end.
interface NextColumn {
  id: string
  name: string
  position: number
}

interface ColumnProps {
  color: import('@trellix/contracts').ColumnColor
  maximized: boolean
  canLeft: boolean
  canRight: boolean
  boardId: string
  boardName: string
  author: string
  maybe: boolean
  notNow: boolean
  tools?: import('remix/component').RemixNode
  columnId: string
  name: string
  items: ItemData[]
  allItems: ItemData[]
  index: number
  last: boolean
  next?: NextColumn
  store: BoardStore
  cards: CardActions
}

function Column(handle: Handle<ColumnProps>) {
  let acceptDrop = false
  let leaving = false
  let list: HTMLElement | undefined
  let confirm: HTMLDialogElement | undefined
  let collapsed = !handle.props.maximized && (handle.props.notNow || (!handle.props.maybe && !handle.props.last))
  let storageKey = `trellix:column:${handle.props.boardId}:${handle.props.columnId}`
  handle.queueTask(() => {
    document.addEventListener('trellix:expand-column', event => {
      let detail = (event as CustomEvent<{ boardId: string; columnId: string }>).detail
      if (detail.boardId !== handle.props.boardId || detail.columnId === handle.props.columnId || (handle.props.maybe && matchMedia('(min-width: 640px)').matches)) return
      collapsed = true
      try { localStorage.setItem(storageKey, 'collapsed') } catch {}
      handle.update()
    }, { signal: handle.signal })
  })
  // Preferences are local to this browser; a blocked storage policy must not break a board.
  if (typeof window !== 'undefined' && !handle.props.maximized) handle.queueTask(() => {
    try {
      let saved = localStorage.getItem(storageKey)
      if (saved) collapsed = saved === 'collapsed'
      else if (matchMedia('(max-width: 639px)').matches) collapsed = !handle.props.maybe
      handle.update()
      if (handle.props.maybe && !collapsed && matchMedia('(max-width: 639px)').matches) handle.queueTask(() => {
        document.querySelector<HTMLElement>('.lane[data-maybe]')?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'instant' })
      })
    } catch {}
  })
  function toggleCollapsed() {
    collapsed = !collapsed
    if (!collapsed && (!handle.props.maybe || matchMedia('(max-width: 639px)').matches)) document.dispatchEvent(new CustomEvent('trellix:expand-column', { detail: { boardId: handle.props.boardId, columnId: handle.props.columnId } }))
    try { if (collapsed) localStorage.setItem(storageKey, 'collapsed'); else localStorage.setItem(storageKey, 'expanded') } catch {}
    handle.update()
    if (!collapsed && matchMedia('(max-width: 639px)').matches) handle.queueTask(() => {
      document.querySelector<HTMLElement>(`.lane[data-column-id="${CSS.escape(handle.props.columnId)}"]`)?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
    })
  }

  async function remove() {
    // Render the exit animation in before the column is removed.
    leaving = true
    await handle.update()
    handle.props.store.submit({ type: 'deleteColumn', id: handle.props.columnId })
  }

  function setAcceptDrop(value: boolean) {
    if (acceptDrop === value) return
    acceptDrop = value
    handle.update()
  }

  // A drop on a card stops there, so the column also clears its highlight on any drop or drag end.
  if (typeof document !== 'undefined') {
    for (let type of ['drop', 'dragend'] as const) {
      document.addEventListener(type, () => setAcceptDrop(false), {
        capture: true,
        signal: handle.signal,
      })
    }
  }

  return () => {
    let { boardId, boardName, author, maybe, notNow, tools, columnId, name, items, allItems, index, last, next, store, cards } = handle.props


    return (
      <section
        aria-label={name}
        data-column-id={columnId}
        class={collapsed ? 'lane lane-collapsed' : 'lane'}
        data-collapsed={collapsed ? '' : undefined}
        data-maybe={maybe ? '' : undefined}
        data-not-now={notNow ? '' : undefined}
        data-done={last ? '' : undefined}
        style={{ '--i': String(Math.min(index, 5)), '--card-count': String(items.length), ...(!maybe && !last && !notNow ? { '--lane-color': `var(--column-${handle.props.color})` } : {}) }}
        data-drop-target={acceptDrop ? 'true' : undefined}
        mix={[
          laneStyle,
          glide(),
          leave(leaving, { transform: 'scale(0.96) translateY(8px)' }),
          // Dropping on the column (not on a card) appends to the end of the list.
          on('dragover', (event) => {
            if (!event.dataTransfer?.types.includes(CARD_MIME_TYPE)) return
            event.preventDefault()
            setAcceptDrop(true)
          }),
          on('dragleave', (event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
              setAcceptDrop(false)
            }
          }),
          on('drop', (event) => {
            event.preventDefault()
            setAcceptDrop(false)
            let card = readDraggedCard(event)
            if (!card) return
            cards.move(card, columnId, appendPosition(allItems))
          }),
        ]}
      >
        <button key="expand" type="button" class="lane-expand" aria-label={`Expand column "${name}"`} aria-expanded="false" mix={on('click', toggleCollapsed)}><span class="count">{items.length}</span><strong>{name}</strong></button>
        <div key="head" class="lane-head">
          <button type="button" class="lane-collapse lane-name" aria-label={`Collapse column "${name}"`} aria-expanded="true" title="Collapse column" disabled={handle.props.maximized} mix={on('click', toggleCollapsed)}><span>{name}</span>{!handle.props.maximized && <BoardGlyph name="collapse" />}</button>
          {!maybe && !notNow && !last && <ColumnMenu name={name} color={handle.props.color} canLeft={handle.props.canLeft} canRight={handle.props.canRight}
            save={(newName, color) => { store.submit({ type: 'upsertColumn', id: columnId, name: newName, color }) }}
            move={direction => { store.submit({ type: 'moveColumn', id: columnId, direction }) }}
            remove={() => confirm?.showModal()} />}
          <a class="lane-maximize" aria-label={`Expand ${name} into grid view`} title="Expand column" href={`${routes.dashboard.boards.show.href({ boardId })}?column=${encodeURIComponent(columnId)}`} data-rmx-document><BoardGlyph name="grid" /></a>
        </div>

        <dialog key="confirm"
          aria-labelledby={`delete-${columnId}-title`}
          mix={[
            confirmStyle,
            ref((node) => (confirm = node)),
            on('click', (event) => {
              if (event.target === event.currentTarget) event.currentTarget.close()
            }),
          ]}
        >
          <form
            method="dialog"
            mix={on('submit', (event) => {
              if (event.submitter?.getAttribute('value') === 'delete') void remove()
            })}
          >
            <h2 id={`delete-${columnId}-title`} mix={confirmTitleStyle}>
              Delete "{name}"?
            </h2>
            <p mix={confirmTextStyle}>
              Its {plural(allItems.length, 'card')} will move back to the intake column. Attachments will be kept.
            </p>
            <div class="composer-row" mix={confirmActionsStyle}>
              <button type="submit" value="cancel" class="btn btn-ghost" autoFocus>
                Cancel
              </button>
              <button type="submit" value="delete" class="btn btn-danger">
                Delete column
              </button>
            </div>
          </form>
        </dialog>

        {tools}
        {/* The list stays mounted when it empties, so the last card can play its exit. */}
        <ul key="cards" class="lane-cards" mix={ref((node) => (list = node))}>
          {items.map((item, cardIndex) => (
            <Card
              key={item.id}
              boardId={boardId}
              boardName={boardName}
              author={author}
              item={item}
              index={cardIndex}
              laneIndex={index}
              items={items}
              last={last}
              next={next}
              store={store}
              cards={cards}
            />
          ))}
        </ul>
        {items.length === 0 && (
          <div key="empty" class="lane-empty">{last ? 'Drop a card here to finish it' : 'Nothing here yet'}</div>
        )}


      </section>
    )
  }
}

// The drag payload carries the card's title so a drop can upsert it even if it is unsaved.
function readDraggedCard(event: DragEvent): { id: string; title: string } | null {
  try {
    let card = JSON.parse(event.dataTransfer?.getData(CARD_MIME_TYPE) ?? '')
    return typeof card?.id === 'string' && typeof card?.title === 'string' ? card : null
  } catch {
    return null
  }
}

interface CardProps {
  boardId: string
  boardName: string
  author: string
  item: ItemData
  index: number
  laneIndex: number
  items: ItemData[]
  last: boolean
  next?: NextColumn
  store: BoardStore
  cards: CardActions
}

function Card(handle: Handle<CardProps>) {
  let acceptDrop: 'none' | 'top' | 'bottom' = 'none'
  let dragging = false
  let leaving = false
  let confirmation: HTMLDialogElement | undefined

  function setAcceptDrop(value: typeof acceptDrop) {
    if (acceptDrop === value) return
    acceptDrop = value
    handle.update()
  }

  return () => {
    let { boardId, boardName, author, item, index, laneIndex, items, last, next, store, cards } = handle.props

    return (
      <li
        data-accept-drop={acceptDrop === 'none' ? undefined : acceptDrop}
        mix={[
          cardSlotStyle,
          glide(),
          leave(leaving, { transform: 'scale(0.9) translateY(-4px)' }),
          // Not stopped here, so the column under the pointer still lights up as the target.
          on('dragover', (event) => {
            if (!event.dataTransfer?.types.includes(CARD_MIME_TYPE)) return
            event.preventDefault()
            let rect = event.currentTarget.getBoundingClientRect()
            setAcceptDrop(event.clientY <= (rect.top + rect.bottom) / 2 ? 'top' : 'bottom')
          }),
          on('dragleave', () => setAcceptDrop('none')),
          on('drop', (event) => {
            event.preventDefault()
            event.stopPropagation()
            let edge: 'top' | 'bottom' = acceptDrop === 'top' ? 'top' : 'bottom'
            setAcceptDrop('none')
            let card = readDraggedCard(event)
            if (!card || card.id === item.id) return
            cards.move(card, item.columnId, dropPosition(items, index, edge))
          }),
        ]}
      >
        <article
          class="card"
          style={{ '--li': String(laneIndex), '--ci': String(Math.min(index, 5)) }}
          draggable
          data-new={cards.isNew(item.id) ? '' : undefined}
          data-dragging={dragging ? '' : undefined}
          data-landed={cards.hasLanded(item.id) ? '' : undefined}
          mix={[
            on('click', (event) => {
              if (!(event.target as HTMLElement).closest('button,a,input,textarea,select,label,form')) cards.open(item.id)
            }),
            on('dragstart', (event) => {
              if (!event.dataTransfer) return
              event.dataTransfer.effectAllowed = 'move'
              event.dataTransfer.setData(
                CARD_MIME_TYPE,
                JSON.stringify({ id: item.id, title: item.title }),
              )
              // After the browser has taken the drag image, so the image is not faded.
              setTimeout(() => {
                dragging = true
                handle.update()
              })
            }),
            on('dragend', () => {
              dragging = false
              handle.update()
            }),
          ]}
        >
          <div class="board-card-tab"><span>{item.id.slice(0, 6).toUpperCase()}</span><span>{boardName}</span></div>
          <div class="card-row">
            <h3 class="card-title"><a class="card-open" data-rmx-document href={routes.dashboard.cards.show.href({ boardId, cardId: item.id })} draggable={false} mix={on('click', (event) => { if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); cards.open(item.id) })}>{item.title}</a></h3>
            <div class="card-actions" mix={cardActionsStyle}>
              {next && (
                <form
                  method="post"
                  action={routes.dashboard.boards.upsertItem.href({ boardId })}
                  mix={on('submit', (event) => {
                    event.preventDefault()
                    cards.move({ id: item.id, title: item.title }, next.id, next.position)
                  })}
                >
                  <input type="hidden" name="id" value={item.id} />
                  <input type="hidden" name="columnId" value={next.id} />
                  <input type="hidden" name="title" value={item.title} />
                  <button
                    type="submit"
                    class="icon-btn"
                    aria-label={`Move "${item.title}" to ${next.name}`}
                    title={`Move to ${next.name}`}
                  >
                    <ArrowRightIcon />
                  </button>
                </form>
              )}
              <AttachButton boardId={boardId} item={item} store={store} />
              <form
                method="post"
                action={routes.dashboard.boards.deleteItem.href({ boardId, itemId: item.id })}
                mix={on('submit', async (event) => {
                  event.preventDefault()
                  confirmation?.showModal()
                })}
              >
                <button
                  type="submit"
                  class="icon-btn danger"
                  aria-label={`Delete card "${item.title}"`}
                  title="Delete card"
                >
                  <TrashIcon />
                </button>
              </form>
            </div>
          </div>
          <footer class="board-card-footer">
            <span class="board-avatar" title={item.author ?? author}>{initials(item.author ?? author)}</span>
            <div class="board-card-meta">
              <span>Added {age(item.createdAt)}</span><span><BoardGlyph name="refresh" />{age(item.updatedAt ?? item.createdAt)}</span>
              <span>{item.author ?? author}</span><span />
            </div>
            <div class="board-card-counts">
              {item.detail?.pinned && <span title="Pinned"><PinIcon /></span>}
              {!!item.detail?.steps && <span title="Steps complete"><CircleCheckIcon />{item.detail.completedSteps}/{item.detail.steps}</span>}
              {!!item.detail?.comments && <span title={`${item.detail.comments} comments`}><BoardGlyph name="comment" />{item.detail.comments}</span>}
            </div>
          </footer>
          {!!item.detail?.tags.length && <div class="card-signals">{item.detail.tags.map(tag => <span class="card-tag">#{tag}</span>)}</div>}
          {item.files.length > 0 && (
            <ul mix={fileListStyle}>
              {item.files.map((file) => (
                <Attachment
                  key={file.id}
                  boardId={boardId}
                  itemId={item.id}
                  file={file}
                  store={store}
                />
              ))}
            </ul>
          )}
        </article>
        <dialog class="confirm-dialog" aria-labelledby={`delete-card-${item.id}`} mix={ref(node => { confirmation = node })}>
          <h2 id={`delete-card-${item.id}`}>Delete this card?</h2><p>“{item.title}” and its steps, discussion, and attachments will be permanently deleted.</p>
          <div class="dialog-actions"><button type="button" class="btn btn-ghost" autoFocus mix={on('click', () => confirmation?.close())}>Keep card</button><button type="button" class="btn btn-danger" mix={on('click', async () => { confirmation?.close(); leaving = true; await handle.update(); store.submit({ type: 'deleteItem', id: item.id }) })}>Delete card</button></div>
        </dialog>
      </li>
    )
  }
}

interface AttachButtonProps {
  boardId: string
  item: ItemData
  store: BoardStore
}

// Picking a file uploads it right away; the attachment shows as "Uploading…" until saved.
function AttachButton(handle: Handle<AttachButtonProps>) {
  return () => {
    let { boardId, item, store } = handle.props
    let inputId = `attach-${item.id}`
    let full = item.files.length >= limits.filesPerCard

    return (
      <form
        method="post"
        encType="multipart/form-data"
        action={routes.dashboard.boards.uploadFile.href({ boardId, itemId: item.id })}
        mix={on('submit', (event) => {
          event.preventDefault()
          let input = event.currentTarget.elements.namedItem('file') as HTMLInputElement
          let file = input.files?.[0]
          input.value = ''
          if (!file) return
          if (file.size === 0) return store.reject('Choose a file that is not empty')
          if (file.size > limits.fileBytes) {
            return store.reject(`Files must be ${limits.fileLabel} or smaller`)
          }
          store.submit({ type: 'uploadFile', id: crypto.randomUUID(), itemId: item.id, file })
        })}
      >
        <input
          id={inputId}
          type="file"
          name="file"
          class="visually-hidden"
          disabled={full}
          mix={on('change', (event) => event.currentTarget.form?.requestSubmit())}
        />
        <label
          htmlFor={inputId}
          class="icon-btn"
          title={full ? `A card can hold up to ${limits.filesPerCard} files` : 'Attach a file'}
          aria-label={`Attach a file to "${item.title}"`}
          data-disabled={full ? '' : undefined}
        >
          <PaperclipIcon />
        </label>
      </form>
    )
  }
}

interface AttachmentProps {
  boardId: string
  itemId: string
  file: FileData
  store: BoardStore
}

function Attachment(handle: Handle<AttachmentProps>) {
  let preview: HTMLDialogElement | undefined

  return () => {
    let { boardId, itemId, file, store } = handle.props
    let href = routes.dashboard.boards.file.href({ boardId, fileId: file.id })
    let thumbnail = !file.pending && isInlineImage(file.type)

    return (
      <li class="attachment" mix={attachmentStyle} data-pending={file.pending ? '' : undefined}>
        {thumbnail && (
          <a
            href={href}
            target="_blank"
            rel="noopener"
            draggable={false}
            aria-label={`Preview ${file.name}`}
            mix={on('click', (event) => {
              if (!preview) return
              event.preventDefault()
              preview.showModal()
            })}
          >
            <img src={href} alt="" loading="lazy" draggable={false} />
          </a>
        )}
        {thumbnail && (
          // Esc closes it natively; clicks on the backdrop land on the dialog itself.
          <dialog
            aria-label={file.name}
            mix={[
              previewStyle,
              ref((node) => (preview = node)),
              on('click', (event) => {
                if (event.target === event.currentTarget) event.currentTarget.close()
              }),
            ]}
          >
            <img src={href} alt={file.name} draggable={false} mix={previewImageStyle} />
            <form method="dialog" class="attachment-meta">
              <span class="attachment-name">{file.name}</span>
              <button type="submit" class="icon-btn" aria-label="Close preview">
                <XIcon />
              </button>
            </form>
          </dialog>
        )}
        <div class="attachment-meta">
          {file.pending ? (
            <span class="attachment-name">{file.name}</span>
          ) : (
            <a
              href={href}
              target={thumbnail ? '_blank' : undefined}
              rel={thumbnail ? 'noopener' : undefined}
              data-rmx-document
              draggable={false}
              class="attachment-name"
            >
              {file.name}
            </a>
          )}
          <span class="mono" mix={css({ whiteSpace: 'nowrap' })}>
            {file.pending ? 'Uploading…' : formatBytes(file.size)}
          </span>
          {!file.pending && (
            <form
              method="post"
              action={routes.dashboard.boards.deleteFile.href({ boardId, fileId: file.id })}
              mix={on('submit', (event) => {
                event.preventDefault()
                store.submit({ type: 'deleteFile', id: file.id, itemId })
              })}
            >
              <button
                type="submit"
                class="icon-btn danger"
                aria-label={`Remove attachment "${file.name}"`}
              >
                <XIcon />
              </button>
            </form>
          )}
        </div>
      </li>
    )
  }
}

// Matches the server, which serves only these raster types inline.
function isInlineImage(type: string) {
  return ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'].includes(type)
}

interface NewColumnProps {
  boardId: string
  index: number
  editInitially: boolean
  store: BoardStore
  onAdd: () => void
}

function NewColumn(handle: Handle<NewColumnProps>) {
  let editing = handle.props.editInitially

  function setEditing(value: boolean) {
    editing = value
    handle.update()
  }

  return () => {
    let { boardId, index, store, onAdd } = handle.props

    if (!editing) {
      return (
        <button
          type="button"
          class="lane-add"
          aria-label="Add column"
          title="Add column"
          mix={on('click', () => {
            setEditing(true)
            onAdd()
          })}
        >
          <PlusIcon />
          <span class="visually-hidden">Add column</span>
        </button>
      )
    }

    return (
      <form
        method="post"
        action={routes.dashboard.boards.upsertColumn.href({ boardId })}
        class="lane composer"
        style={{ '--i': String(Math.min(index, 5)) }}
        mix={[
          on('submit', (event) => {
            event.preventDefault()
            let input = event.currentTarget.elements.namedItem('name') as HTMLInputElement
            let name = input.value.trim()
            if (!name) return
            store.submit({ type: 'upsertColumn', id: crypto.randomUUID(), name })
            input.value = ''
            onAdd()
          }),
          ref((form, signal) => dismissOnOutside(form, signal, () => setEditing(false))),
        ]}
      >
        <input
          name="name"
          required
          maxLength={limits.name}
          aria-label="Column name"
          placeholder="Column name"
          autoComplete="off"
          class="field"
          mix={[
            ref((node) => node.focus()),
            on('keydown', (event) => {
              if (event.key === 'Escape') setEditing(false)
            }),
          ]}
        />
        <div class="composer-row">
          <button type="submit" class="btn btn-primary">
            Save column
          </button>
          <button type="button" class="btn btn-ghost" mix={on('click', () => setEditing(false))}>
            Cancel
          </button>
        </div>
      </form>
    )
  }
}

interface EditableTextProps {
  value: string
  displayLabel?: string
  // Where the field posts without JavaScript, plus any fields the action needs.
  action: string
  hidden?: Record<string, string>
  inputLabel: string
  buttonLabel: string
  onSave: (value: string) => void
}

// A heading that turns into an input on click. Enter or clicking away saves, Escape cancels.
function EditableText(handle: Handle<EditableTextProps>) {
  let editing = false
  let button: HTMLButtonElement | undefined

  async function finish(save: string | null) {
    if (!editing) return
    editing = false
    let value = save?.trim()
    if (value && value !== handle.props.value) handle.props.onSave(value)
    await handle.update()
    button?.focus()
  }

  return () => {
    let { value, action, hidden = {}, inputLabel, buttonLabel } = handle.props

    if (!editing) {
      return (
        <button
          type="button"
          aria-label={buttonLabel}
          mix={[
            editableButtonStyle,
            ref((node) => (button = node)),
            on('click', async () => {
              editing = true
              await handle.update()
            }),
          ]}
        >
          {handle.props.displayLabel ?? value}
        </button>
      )
    }

    return (
      <form
        method="post"
        action={action}
        mix={[
          on('submit', (event) => {
            event.preventDefault()
            let input = event.currentTarget.elements.namedItem('name') as HTMLInputElement
            finish(input.value)
          }),
          ref((form, signal) =>
            dismissOnOutside(form, signal, () => {
              let input = form.elements.namedItem('name') as HTMLInputElement
              finish(input.value)
            }),
          ),
        ]}
      >
        {Object.entries(hidden).map(([name, hiddenValue]) => (
          <input key={name} type="hidden" name={name} value={hiddenValue} />
        ))}
        <input
          name="name"
          required
          maxLength={limits.name}
          defaultValue={value}
          aria-label={inputLabel}
          autoComplete="off"
          class="field"
          mix={[
            editableInputStyle,
            ref((node) => node.select()),
            on('keydown', (event) => {
              if (event.key === 'Escape') finish(null)
            }),
          ]}
        />
      </form>
    )
  }
}

// Calls onDismiss when the user presses or focuses something outside `container`. Focus that is
// only dropped to <body> is put back instead: a page reload in place can move the DOM around a
// focused field (Remix re-places the app shell when extensions have injected nodes into
// <body>), and that should not close the form the user is typing in.
function dismissOnOutside(container: HTMLFormElement, signal: AbortSignal, onDismiss: () => void) {
  let lastFocused: HTMLElement | null = null
  let isOutside = (target: EventTarget | null) =>
    !(target instanceof Node && container.contains(target))

  document.addEventListener(
    'pointerdown',
    (event) => {
      if (isOutside(event.target)) onDismiss()
    },
    { capture: true, signal },
  )
  document.addEventListener(
    'focusin',
    (event) => {
      if (isOutside(event.target)) onDismiss()
      else lastFocused = event.target as HTMLElement
    },
    { capture: true, signal },
  )
  container.addEventListener(
    'focusout',
    (event) => {
      if (event.relatedTarget) return
      setTimeout(() => {
        if (signal.aborted || !container.isConnected) return
        if (document.activeElement && document.activeElement !== document.body) return
        let field =
          lastFocused ?? container.querySelector<HTMLElement>('textarea, input:not([type=hidden])')
        field?.focus()
      })
    },
    { signal },
  )
}

// Layout glue for the board. Everything visual comes from the theme's classes and tokens.

const laneStyle = css({
  '& .lane-done': { color: 'var(--done)' },
})

const confirmStyle = css({
  width: 'min(420px, calc(100vw - 2 * var(--gutter)))',
  padding: 'var(--s5)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--r-xl)',
  background: 'var(--surface)',
  color: 'var(--ink)',
  boxShadow: 'var(--shadow-3)',
  '&::backdrop': { background: 'color-mix(in oklab, var(--bg-sunk) 80%, transparent)' },
  '& form': { display: 'flex', flexDirection: 'column', gap: 'var(--s3)' },
})

const confirmTitleStyle = css({ fontSize: 'var(--text-title)', overflowWrap: 'anywhere' })

const confirmTextStyle = css({ margin: 0, color: 'var(--ink-2)' })

const confirmActionsStyle = css({ justifyContent: 'flex-end', marginTop: 'var(--s2)' })

// A line above or below the card shows where a dropped card will land.
const cardSlotStyle = css({
  position: 'relative',
  '&[data-accept-drop]::before': {
    content: '""',
    position: 'absolute',
    left: 'var(--s1)',
    right: 'var(--s1)',
    height: 'calc(var(--s1) / 2)',
    borderRadius: 'var(--r-pill)',
    background: 'var(--accent)',
  },
  '&[data-accept-drop="top"]::before': { top: 'calc(var(--s2) / -2 - var(--s1) / 4)' },
  '&[data-accept-drop="bottom"]::before': { bottom: 'calc(var(--s2) / -2 - var(--s1) / 4)' },
})

const cardActionsStyle = css({
  '& form': { display: 'contents' },
  // The attach control is a label for a hidden file input; it takes the input's focus ring.
  '& input:focus-visible + .icon-btn': { boxShadow: 'var(--ring)' },
  '& .icon-btn[data-disabled]': { opacity: 0.4, cursor: 'not-allowed' },
})

const fileListStyle = css({
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--s2)',
})

const attachmentStyle = css({
  '&[data-pending]': { opacity: 0.6 },
  '& > a': { display: 'block' },
  '& form': { display: 'contents' },
  '& a.attachment-name': { textDecoration: 'none' },
  '& a.attachment-name:hover': { color: 'var(--accent)', textDecoration: 'underline' },
})

const previewStyle = css({
  padding: 0,
  border: '1px solid var(--line)',
  borderRadius: 'var(--r-lg)',
  maxWidth: 'min(92vw, 1200px)',
  maxHeight: '92vh',
  overflow: 'hidden',
  background: 'var(--surface)',
  color: 'var(--ink)',
  boxShadow: 'var(--shadow-3)',
  '&::backdrop': { background: 'color-mix(in oklab, var(--bg-sunk) 80%, transparent)' },
  '&[open]': { display: 'flex', flexDirection: 'column' },
  '& .attachment-meta': { padding: 'var(--s1) var(--s1) var(--s1) var(--s3)' },
})

const previewImageStyle = css({
  display: 'block',
  minHeight: 0,
  maxWidth: '100%',
  maxHeight: 'calc(92vh - var(--s7))',
  objectFit: 'contain',
  margin: '0 auto',
})

const editableButtonStyle = css({
  display: 'block',
  margin: 0,
  padding: '0 var(--s1)',
  marginLeft: 'calc(var(--s1) * -1)',
  border: 0,
  borderRadius: 'var(--r-sm)',
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  letterSpacing: 'inherit',
  textAlign: 'left',
  overflowWrap: 'anywhere',
  cursor: 'text',
  '&:hover': { background: 'color-mix(in oklab, var(--ink) 7%, transparent)' },
})

const editableInputStyle = css({
  font: 'inherit',
  letterSpacing: 'inherit',
  padding: '0 var(--s2)',
  minHeight: 0,
})

export function BoardGlyph(handle: Handle<{ name: string }>) {
  return () => <span class="board-glyph" aria-hidden="true" style={{ maskImage: `url(/icons/fizzy/${handle.props.name}.svg)` }} />
}
function initials(name: string) { return name.trim().split(/\s+/).map(part => part[0]).slice(0, 2).join('').toUpperCase() }
function age(at?: number) { if (!at) return 'today'; let days = Math.max(0, Math.floor((Date.now() - at) / 86400000)); return days ? `${days} ${days === 1 ? 'day' : 'days'} ago` : 'today' }
