import { clientEntry, css, on, ref } from 'remix/component'
import type { Handle } from 'remix/component'

import { routes } from '../../../../routes.ts'
import {
  appendPosition,
  applyMutations,
  BoardStore,
  CARD_MIME_TYPE,
  dropPosition,
  type BoardData,
  type ItemData,
} from './board-model.ts'

// A port of Trellix (github.com/remix-run/example-trellix). The server renders the board;
// in the browser every edit renders immediately from BoardStore while the request runs, then
// the page reloads in place to pick up the saved data.
export const Board = clientEntry(
  import.meta.url,
  function Board(handle: Handle<{ board: BoardData }>) {
    let store = new BoardStore(handle.props.board.id, () => handle.frame.reload())
    let scroller: HTMLElement | undefined

    store.addEventListener('change', () => handle.update(), { signal: handle.signal })
    handle.frame.addEventListener('reloadComplete', () => store.reloaded(), {
      signal: handle.signal,
    })

    function scrollToEnd() {
      handle.queueTask(() => {
        if (scroller) scroller.scrollLeft = scroller.scrollWidth
      })
    }

    return () => {
      let { board } = handle.props
      let view = applyMutations(board, store.mutations)

      return (
        <div
          mix={boardStyle}
          style={{ background: `color-mix(in srgb, ${board.color} 45%, var(--surface-0))` }}
        >
          <h1 mix={boardTitleStyle}>
            <EditableText
              value={view.name}
              action={routes.dashboard.boards.rename.href({ boardId: board.id })}
              inputLabel="Edit board name"
              buttonLabel={`Edit board "${view.name}" name`}
              onSave={(name) => store.submit({ type: 'renameBoard', name })}
            />
          </h1>

          {store.error && (
            <p role="alert" mix={alertStyle}>
              {store.error}
              <button
                type="button"
                mix={[ghostButtonStyle, on('click', () => store.dismissError())]}
              >
                Dismiss
              </button>
            </p>
          )}

          <div mix={[columnsStyle, ref((node) => (scroller = node))]}>
            {view.columns.map((column) => (
              <Column
                key={column.id}
                boardId={board.id}
                columnId={column.id}
                name={column.name}
                items={column.items}
                store={store}
              />
            ))}
            <NewColumn
              boardId={board.id}
              editInitially={board.columns.length === 0}
              store={store}
              onAdd={scrollToEnd}
            />
            {/* Room past the last column so it does not touch the scroll edge. */}
            <div aria-hidden="true" mix={css({ width: '8px', flexShrink: 0 })} />
          </div>
        </div>
      )
    }
  },
)

interface ColumnProps {
  boardId: string
  columnId: string
  name: string
  items: ItemData[]
  store: BoardStore
}

function Column(handle: Handle<ColumnProps>) {
  let acceptDrop = false
  let adding = false
  let list: HTMLElement | undefined

  function scrollList() {
    handle.queueTask(() => {
      if (list) list.scrollTop = list.scrollHeight
    })
  }

  function setAcceptDrop(value: boolean) {
    if (acceptDrop === value) return
    acceptDrop = value
    handle.update()
  }

  return () => {
    let { boardId, columnId, name, items, store } = handle.props

    return (
      <section
        aria-label={name}
        mix={[
          columnStyle,
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
            store.submit({ ...card, type: 'upsertItem', columnId, position: appendPosition(items) })
          }),
        ]}
        data-accept-drop={acceptDrop ? '' : undefined}
      >
        <h2 mix={columnTitleStyle}>
          <EditableText
            value={name}
            action={routes.dashboard.boards.upsertColumn.href({ boardId })}
            hidden={{ id: columnId }}
            inputLabel="Edit column name"
            buttonLabel={`Edit column "${name}" name`}
            onSave={(newName) =>
              store.submit({ type: 'upsertColumn', id: columnId, name: newName })
            }
          />
        </h2>

        <ul mix={[cardListStyle, ref((node) => (list = node))]}>
          {items.map((item, index) => (
            <Card
              key={item.id}
              boardId={boardId}
              item={item}
              index={index}
              items={items}
              store={store}
            />
          ))}
        </ul>

        {adding ? (
          <NewCard
            boardId={boardId}
            columnId={columnId}
            items={items}
            store={store}
            onAdd={scrollList}
            onComplete={() => {
              adding = false
              handle.update()
            }}
          />
        ) : (
          <button
            type="button"
            mix={[
              addCardButtonStyle,
              on('click', () => {
                adding = true
                handle.update()
                scrollList()
              }),
            ]}
          >
            <span aria-hidden="true">+</span> Add a card
          </button>
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
  item: ItemData
  index: number
  items: ItemData[]
  store: BoardStore
}

function Card(handle: Handle<CardProps>) {
  let acceptDrop: 'none' | 'top' | 'bottom' = 'none'

  function setAcceptDrop(value: typeof acceptDrop) {
    if (acceptDrop === value) return
    acceptDrop = value
    handle.update()
  }

  return () => {
    let { boardId, item, index, items, store } = handle.props

    return (
      <li
        data-accept-drop={acceptDrop === 'none' ? undefined : acceptDrop}
        mix={[
          cardSlotStyle,
          on('dragover', (event) => {
            if (!event.dataTransfer?.types.includes(CARD_MIME_TYPE)) return
            event.preventDefault()
            event.stopPropagation()
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
            store.submit({
              ...card,
              type: 'upsertItem',
              columnId: item.columnId,
              position: dropPosition(items, index, edge),
            })
          }),
        ]}
      >
        <div
          draggable
          mix={[
            cardStyle,
            on('dragstart', (event) => {
              if (!event.dataTransfer) return
              event.dataTransfer.effectAllowed = 'move'
              event.dataTransfer.setData(
                CARD_MIME_TYPE,
                JSON.stringify({ id: item.id, title: item.title }),
              )
            }),
          ]}
        >
          <h3 mix={css({ margin: 0, fontSize: 'inherit', fontWeight: 400, paddingRight: '24px' })}>
            {item.title}
          </h3>
          <form
            method="post"
            action={routes.dashboard.boards.deleteItem.href({ boardId, itemId: item.id })}
            mix={on('submit', (event) => {
              event.preventDefault()
              store.submit({ type: 'deleteItem', id: item.id })
            })}
          >
            <button
              type="submit"
              aria-label={`Delete card "${item.title}"`}
              mix={deleteButtonStyle}
            >
              <TrashIcon />
            </button>
          </form>
        </div>
      </li>
    )
  }
}

interface NewCardProps {
  boardId: string
  columnId: string
  items: ItemData[]
  store: BoardStore
  onAdd: () => void
  onComplete: () => void
}

// Stays open after each save so cards can be entered one after another, like Trellix.
function NewCard(handle: Handle<NewCardProps>) {
  return () => {
    let { boardId, columnId, items, store, onAdd, onComplete } = handle.props

    return (
      <form
        method="post"
        action={routes.dashboard.boards.upsertItem.href({ boardId })}
        mix={[
          newCardStyle,
          on('submit', (event) => {
            event.preventDefault()
            let textarea = event.currentTarget.elements.namedItem('title') as HTMLTextAreaElement
            let title = textarea.value.trim()
            if (!title) return
            store.submit({
              type: 'upsertItem',
              id: crypto.randomUUID(),
              columnId,
              title,
              position: appendPosition(items),
            })
            textarea.value = ''
            textarea.style.height = ''
            onAdd()
          }),
          ref((form, signal) => dismissOnOutside(form, signal, () => handle.props.onComplete())),
        ]}
      >
        <input type="hidden" name="columnId" value={columnId} />
        <textarea
          name="title"
          required
          rows={2}
          aria-label="Card title"
          placeholder="Enter a title for this card"
          mix={[
            textareaStyle,
            ref((node) => node.focus()),
            on('keydown', (event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                event.currentTarget.form?.requestSubmit()
              }
              if (event.key === 'Escape') onComplete()
            }),
            on('input', (event) => {
              let node = event.currentTarget
              node.style.height = `${node.scrollHeight}px`
            }),
          ]}
        />
        <div mix={formActionsStyle}>
          <button type="submit" mix={saveButtonStyle}>
            Save card
          </button>
          <button type="button" mix={[ghostButtonStyle, on('click', onComplete)]}>
            Cancel
          </button>
        </div>
      </form>
    )
  }
}

interface NewColumnProps {
  boardId: string
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
    let { boardId, store, onAdd } = handle.props

    if (!editing) {
      return (
        <button
          type="button"
          aria-label="Add new column"
          mix={[
            addColumnButtonStyle,
            on('click', () => {
              setEditing(true)
              onAdd()
            }),
          ]}
        >
          +
        </button>
      )
    }

    return (
      <form
        method="post"
        action={routes.dashboard.boards.upsertColumn.href({ boardId })}
        mix={[
          columnStyle,
          newColumnStyle,
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
          maxLength={100}
          aria-label="Column name"
          placeholder="Column name"
          autoComplete="off"
          mix={[
            textInputStyle,
            ref((node) => node.focus()),
            on('keydown', (event) => {
              if (event.key === 'Escape') setEditing(false)
            }),
          ]}
        />
        <div mix={formActionsStyle}>
          <button type="submit" mix={saveButtonStyle}>
            Save column
          </button>
          <button type="button" mix={[ghostButtonStyle, on('click', () => setEditing(false))]}>
            Cancel
          </button>
        </div>
      </form>
    )
  }
}

interface EditableTextProps {
  value: string
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
          {value}
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
          maxLength={100}
          defaultValue={value}
          aria-label={inputLabel}
          autoComplete="off"
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

function TrashIcon() {
  return () => (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
      <path
        d="M2.5 4h11M6 4V2.5h4V4m-6 0 .7 9.1a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9L12 4"
        stroke="currentColor"
        stroke-width="1.4"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  )
}

const border = '1px solid color-mix(in srgb, var(--text-tertiary) 35%, transparent)'

const boardStyle = css({
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
})

const boardTitleStyle = css({ margin: '16px 24px', fontSize: '22px', fontWeight: 700 })

const columnsStyle = css({
  flex: 1,
  minHeight: 0,
  display: 'flex',
  alignItems: 'flex-start',
  gap: '16px',
  padding: '0 24px 24px',
  overflowX: 'auto',
})

const columnStyle = css({
  flexShrink: 0,
  width: '288px',
  maxHeight: '100%',
  display: 'flex',
  flexDirection: 'column',
  borderRadius: '14px',
  background: 'var(--surface-3)',
  boxShadow: '0 1px 2px rgb(0 0 0 / 0.12)',
  '&[data-accept-drop]': { outline: '2px solid var(--brand-blue)' },
})

const columnTitleStyle = css({ margin: 0, padding: '8px 8px 4px', fontSize: '14px' })

const cardListStyle = css({
  listStyle: 'none',
  margin: 0,
  padding: '0 8px',
  flex: '1 1 auto',
  minHeight: '2px',
  overflowY: 'auto',
})

// The slot's borders double as the drop indicator above or below the card.
const cardSlotStyle = css({
  padding: '3px 0',
  borderTop: '2px solid transparent',
  borderBottom: '2px solid transparent',
  '&:not(:last-child)': { marginBottom: '-2px' },
  '&[data-accept-drop="top"]': { borderTopColor: 'var(--brand-blue)' },
  '&[data-accept-drop="bottom"]': { borderBottomColor: 'var(--brand-blue)' },
})

const cardStyle = css({
  position: 'relative',
  padding: '8px 10px',
  borderRadius: '10px',
  background: 'var(--surface-4)',
  border,
  cursor: 'grab',
  overflowWrap: 'anywhere',
  '&:active': { cursor: 'grabbing' },
  '& form': { margin: 0 },
})

const deleteButtonStyle = css({
  position: 'absolute',
  top: '6px',
  right: '6px',
  display: 'grid',
  placeItems: 'center',
  width: '24px',
  height: '24px',
  padding: 0,
  border: 0,
  borderRadius: '6px',
  background: 'transparent',
  color: 'var(--text-tertiary)',
  cursor: 'pointer',
  '&:hover, &:focus-visible': { color: 'var(--danger)', background: 'var(--surface-3)' },
})

const buttonBase = {
  font: 'inherit',
  border: 0,
  borderRadius: '8px',
  cursor: 'pointer',
  '&:focus-visible': { outline: '2px solid var(--brand-blue)', outlineOffset: '1px' },
}

const addCardButtonStyle = css({
  ...buttonBase,
  margin: '4px 8px 8px',
  padding: '8px',
  textAlign: 'left',
  background: 'transparent',
  color: 'var(--text-tertiary)',
  '&:hover': { background: 'var(--surface-4)', color: 'var(--text-primary)' },
})

const addColumnButtonStyle = css({
  ...buttonBase,
  flexShrink: 0,
  width: '56px',
  height: '56px',
  fontSize: '24px',
  borderRadius: '14px',
  background: 'color-mix(in srgb, var(--surface-3) 60%, transparent)',
  color: 'var(--text-primary)',
  '&:hover': { background: 'var(--surface-3)' },
})

const saveButtonStyle = css({
  ...buttonBase,
  padding: '8px 12px',
  fontWeight: 700,
  background: 'var(--brand-blue)',
  color: '#fff',
})

const ghostButtonStyle = css({
  ...buttonBase,
  padding: '8px 12px',
  background: 'transparent',
  color: 'inherit',
  '&:hover': { background: 'var(--surface-4)' },
})

const formActionsStyle = css({ display: 'flex', justifyContent: 'space-between' })

const newCardStyle = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
  padding: '4px 8px 8px',
})

const newColumnStyle = css({ gap: '12px', padding: '8px' })

const fieldBase = {
  font: 'inherit',
  width: '100%',
  padding: '6px 8px',
  borderRadius: '8px',
  border: '1px solid var(--text-tertiary)',
  background: 'var(--surface-4)',
  color: 'var(--text-primary)',
  '&:focus-visible': { outline: '2px solid var(--brand-blue)', outlineOffset: '0' },
}

const textInputStyle = css(fieldBase)

const textareaStyle = css({ ...fieldBase, resize: 'none', minHeight: '56px' })

const editableButtonStyle = css({
  ...buttonBase,
  display: 'block',
  width: '100%',
  padding: '4px 8px',
  textAlign: 'left',
  fontWeight: 'inherit',
  fontSize: 'inherit',
  background: 'transparent',
  color: 'inherit',
  border: '1px solid transparent',
  '&:hover': { borderColor: 'color-mix(in srgb, var(--text-tertiary) 50%, transparent)' },
})

const editableInputStyle = css({
  ...fieldBase,
  padding: '4px 8px',
  fontWeight: 'inherit',
  fontSize: 'inherit',
})

const alertStyle = css({
  margin: '0 24px 12px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '12px',
  padding: '8px 8px 8px 14px',
  borderRadius: '10px',
  background: 'var(--surface-3)',
  color: 'var(--danger)',
})
