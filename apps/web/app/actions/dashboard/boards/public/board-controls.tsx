import * as menu from '@remix-run/ui/menu'
import * as popover from '@remix-run/ui/popover'
import { navigate, on, ref, type Handle, type RemixNode } from 'remix/component'
import { columnColors, type ColumnColor, type BoardData, type ItemData } from '@trellix/contracts'
import { appRequest } from '../../public/app-request.ts'
import { routes } from '../../../../routes.ts'

export function Glyph(handle: Handle<{ name: string }>) {
  return () => <span aria-hidden="true" class="board-glyph" style={{ maskImage: `url('/icons/fizzy/${handle.props.name}.svg')` }} />
}

// Column options: a popover (anchoring, Escape and outside dismissal, focus return) that switches
// between the column actions and the edit form.
export function ColumnMenu(handle: Handle<{ name: string; color: ColumnColor; canLeft: boolean; canRight: boolean; save(name: string, color: ColumnColor): void; move(direction: 'left' | 'right'): void; remove(): void }>) {
  let open = false, editing = false
  let color = handle.props.color
  let draftName = handle.props.name
  let trigger: HTMLElement | undefined, surface: HTMLElement | undefined, nameInput: HTMLInputElement | undefined
  async function show() {
    open = true; editing = false; handle.update()
    await handle.update()
    surface?.querySelector<HTMLElement>('button:not(:disabled)')?.focus({ preventScroll: true })
  }
  function hide() { open = false; editing = false; handle.update() }
  async function edit() {
    draftName = handle.props.name; color = handle.props.color; editing = true
    await handle.update()
    nameInput?.focus(); nameInput?.select()
  }
  // Return focus before acting, so a dialog the action opens (delete confirmation) restores it
  // to the trigger rather than to a button in the hidden popover.
  function act(run: () => void) { hide(); trigger?.focus({ preventScroll: true }); run() }
  return () => {
    let label = `Column options for ${handle.props.name}`
    return <div class="lane-menu"><popover.Context>
      <button type="button" class="board-popup-trigger" aria-label={label} aria-haspopup="dialog" aria-expanded={open ? 'true' : 'false'}
        mix={[ref(node => { trigger = node }), popover.anchor({ placement: 'bottom-start', offset: 4 }), popover.focusOnHide(), on('click', () => { void show() })]}><Glyph name="menu-dots-horizontal" /></button>
      <div class={editing ? 'board-popup column-edit-popup' : 'board-popup'} role="dialog" aria-label={label} mix={[
        ref(node => { surface = node }),
        popover.surface({ open, onHide: hide }),
        on('keydown', event => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return
          if (event.target instanceof HTMLInputElement) return
          let controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input')]
          let index = controls.indexOf(document.activeElement as HTMLElement)
          let next = event.key === 'Home' ? 0 : event.key === 'End' ? controls.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + controls.length) % controls.length
          event.preventDefault(); controls[next]?.focus()
        }),
      ]}>
        {editing ? <form class="column-edit-form" mix={on('submit', event => {
          event.preventDefault()
          let name = String(new FormData(event.currentTarget).get('name') ?? '').trim()
          if (name) act(() => handle.props.save(name, color))
        })}>
          <input class="input" name="name" aria-label="Column name" value={draftName} maxLength={100} required pattern=".*\S.*" mix={[ref(node => { nameInput = node }), on('input', event => { draftName = event.currentTarget.value; handle.update() })]} />
          <div class="column-colors" role="radiogroup" aria-label="Column color">
            {columnColors.map(value => <label key={value} class="column-color" title={value[0].toUpperCase() + value.slice(1)} style={{ backgroundColor: `var(--column-${value})` }}>
              <input type="radio" name="color" value={value} aria-label={value[0].toUpperCase() + value.slice(1)} checked={color === value} mix={on('change', () => { color = value; handle.update() })} />
              {color === value && <Glyph name="check" />}
            </label>)}
          </div>
          <button type="submit" class="column-save">Save changes</button>
        </form> : <div class="column-menu-options">
          <button type="button" class="popup-option" mix={on('click', () => { void edit() })}><Glyph name="pencil" /><span>Edit column</span></button>
          <button type="button" class="popup-option" disabled={!handle.props.canLeft} mix={on('click', () => act(() => handle.props.move('left')))}><Glyph name="column-left" /><span>Move to the left</span></button>
          <button type="button" class="popup-option" disabled={!handle.props.canRight} mix={on('click', () => act(() => handle.props.move('right')))}><Glyph name="column-right" /><span>Move to the right</span></button>
          <button type="button" class="popup-option popup-negative" mix={on('click', () => act(() => handle.props.remove()))}><Glyph name="trash" /><span>Delete column</span></button>
        </div>}
      </div>
    </popover.Context></div>
  }
}

// A toolbar dropdown (@remix-run/ui/menu: keyboard navigation, typeahead, checked items, focus
// return). Choices bubble as MenuSelectEvents to the toolbar's onMenuSelect.
function FilterMenu(handle: Handle<{ label: string; text?: string; selected?: boolean; note?: RemixNode; children: RemixNode }>) {
  return () => {
    let { label, text, selected, note, children } = handle.props
    return <div class="board-quick-filter"><menu.Context label={label}>
      <button type="button" class="board-popup-trigger" aria-label={label} data-selected={selected || undefined} mix={menu.trigger({ placement: 'bottom', offset: 4 })}>
        <span>{text ?? label}</span><Glyph name="chevron-down" />
      </button>
      <div class="board-popup" mix={menu.popover()}>
        <strong class="popup-title" aria-hidden="true">{label}</strong>
        {note}
        <div class="board-menu-list" mix={menu.list()}>{children}</div>
      </div>
    </menu.Context></div>
  }
}

export interface Filters { query: string; sort: string; status: string; tags: string[]; assignee: string; creator: string; closer: string }
export function defaultFilters(): Filters { return { query: '', sort: 'latest', status: 'all', tags: [], assignee: '', creator: '', closer: '' } }
export function matchesFilters(item: ItemData, filters: Filters, board: BoardData, userId: string): boolean {
  let needle = filters.query.trim().toLowerCase().replace(/^#/, '')
  let ordered = [...board.columns].filter(column => column.name.toLowerCase() !== 'not now').sort((a, b) => a.position - b.position)
  let done = item.columnId === ordered.at(-1)?.id
  let notNow = board.columns.find(column => column.id === item.columnId)?.name.toLowerCase() === 'not now'
  let snoozed = (item.detail?.snoozedUntil ?? 0) > Date.now()
  return (!needle || `${item.title} ${item.id} ${item.detail?.tags.join(' ') ?? ''}`.toLowerCase().includes(needle))
    && (filters.status === 'snoozed' ? snoozed : !snoozed)
    && (filters.status !== 'closed' || done)
    && (filters.status !== 'open' || !done && !notNow)
    && (filters.status !== 'not_now' || notNow)
    && (filters.status !== 'pinned' || !!item.detail?.pinned)
    && (filters.status !== 'urgent' || item.detail?.priority === 'urgent')
    && (!filters.tags.length || filters.tags.some(tag => item.detail?.tags.includes(tag)))
    && (!filters.assignee || (filters.assignee === 'unassigned' ? !item.assigneeId : item.assigneeId === filters.assignee))
    && (!filters.creator || filters.creator === userId)
    && (!filters.closer || done && filters.closer === userId)
}

export function BoardFilters(handle: Handle<{ board: BoardData; user: { id: string; name: string }; filters: Filters; onChange(filters: Filters): void; searchRef(node: HTMLInputElement): void }>) {
  let expanded = false
  let boards: { id: string; name: string }[] = [handle.props.board]
  let error = ''
  function change(values: Partial<Filters>) { handle.props.onChange({ ...handle.props.filters, ...values }) }
  async function toggle() {
    expanded = !expanded; handle.update()
    if (expanded) try { boards = await appRequest(routes.dashboard.boards.options.href()); error = ''; handle.update() } catch { error = 'Could not load boards'; handle.update() }
  }
  function choice(label: string, field: 'sort' | 'status' | 'assignee' | 'creator' | 'closer', options: [string, string][], defaultValue = '') {
    let value = handle.props.filters[field]
    let text = value === defaultValue ? label : options.find(([id]) => id === value)?.[1] ?? label
    return <FilterMenu label={label} text={text} selected={value !== defaultValue && field !== 'sort'}>
      {options.map(([id, name]) => <div key={id} class="popup-option" mix={menu.item({ name: field, value: id, type: 'radio', checked: value === id, label: name })}><span>{name}</span>{value === id && <Glyph name="check" />}</div>)}
    </FilterMenu>
  }
  function select(event: menu.MenuSelectEvent) {
    let { name, value } = event.item
    if (value === null) return
    if (name === 'board') void navigate(routes.dashboard.boards.show.href({ boardId: value }))
    else if (name === 'tag') { let tags = handle.props.filters.tags; change({ tags: tags.includes(value) ? tags.filter(tag => tag !== value) : [...tags, value] }) }
    else change({ [name]: value })
  }
  return () => {
    let { board, user, filters } = handle.props
    let tags = [...new Set(board.items.flatMap(item => item.detail?.tags ?? []))].sort()
    let active = filters.status !== 'all' || filters.tags.length || filters.assignee || filters.creator || filters.closer || filters.query || filters.sort !== 'latest'
    return <div class="board-toolbar" data-expanded={expanded || undefined} mix={menu.onMenuSelect(select)}>
      <div class="board-filter-pill"><input class="board-search" type="search" placeholder="Filter these cards… [F]" aria-label="Filter cards" value={filters.query} mix={[ref(handle.props.searchRef), on('input', event => change({ query: event.currentTarget.value }))]} />
        {!expanded && <button type="button" aria-label="Card filters" aria-expanded="false" mix={on('click', toggle)}><Glyph name="filter" /></button>}
      </div>
      {expanded && <>
        <FilterMenu label="Board…" note={error && <p role="alert">{error}</p>}>{boards.map(option => <div key={option.id} class="popup-option" mix={menu.item({ name: 'board', value: option.id, label: option.name })}><span>{option.name}</span>{option.id === board.id && <Glyph name="check" />}</div>)}</FilterMenu>
        {choice('Recently updated', 'sort', [['latest','Recently updated'],['newest','Newest to oldest'],['oldest','Oldest to newest']], 'latest')}
        {choice('Status…', 'status', [['all','All'],['open','Open'],['closed','Closed'],['not_now','Not now'],['pinned','Pinned'],['urgent','Urgent'],['snoozed','Snoozed']], 'all')}
        <FilterMenu label="Tagged…" text={filters.tags.length ? filters.tags.map(tag => `#${tag}`).join(', ') : 'Tagged…'} selected={!!filters.tags.length}
          note={!tags.length && <p class="popup-empty">No tags on this board yet.</p>}>
          {tags.map(tag => <div key={tag} class="popup-option" mix={menu.item({ name: 'tag', value: tag, type: 'checkbox', checked: filters.tags.includes(tag), label: `#${tag}` })}><span>#{tag}</span>{filters.tags.includes(tag) && <Glyph name="check" />}</div>)}
        </FilterMenu>
        {choice('Assigned to…','assignee',[['','Anyone'],['unassigned','No one'],[user.id,user.name]])}
        {choice('Added by…','creator',[['','Anyone'],[user.id,user.name]])}
        {choice('Closed by…','closer',[['','Anyone'],[user.id,user.name]])}
        <button type="button" class="board-filter-toggle" aria-label="Card filters" title="Collapse filter options" aria-expanded="true" mix={on('click', toggle)}><Glyph name="filter" /></button>
      </>}
      {!!active && <button type="button" class="board-clear-filters" mix={on('click', () => handle.props.onChange(defaultFilters()))}>Clear filters</button>}
    </div>
  }
}
