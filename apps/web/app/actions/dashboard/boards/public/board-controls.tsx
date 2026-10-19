import { on, ref, type Handle, type RemixNode } from 'remix/component'
import { columnColors, type ColumnColor, type BoardData, type ItemData } from '@trellix/contracts'
import { appRequest } from '../../public/app-request.ts'
import { routes } from '../../../../routes.ts'

export function Glyph(handle: Handle<{ name: string }>) {
  return () => <span aria-hidden="true" class="board-glyph" style={{ maskImage: `url('/icons/fizzy/${handle.props.name}.svg')` }} />
}

// Native popovers escape the horizontally scrolling lanes and provide Escape/light dismissal.
function place(popup: HTMLElement, anchor: HTMLElement, align: 'start' | 'center') {
  let rect = anchor.getBoundingClientRect()
  popup.style.visibility = 'hidden'
  popup.showPopover()
  let width = popup.offsetWidth, height = popup.offsetHeight
  popup.style.left = `${Math.max(8, Math.min(innerWidth - width - 8, align === 'start' ? rect.left : rect.left + rect.width / 2 - width / 2))}px`
  popup.style.top = `${Math.max(8, Math.min(rect.bottom + 4, innerHeight - height - 8))}px`
  popup.style.visibility = ''
}
export function Popup(handle: Handle<{ label: string; text?: string; icon?: string; className?: string; selected?: boolean; children: RemixNode; align?: 'start' | 'center'; editing?: boolean; onClose?(): void }>) {
  let popup: HTMLDivElement | undefined, trigger: HTMLButtonElement | undefined
  let open = false
  return () => <div class={handle.props.className ?? 'board-quick-filter'}>
    <button type="button" class="board-popup-trigger" aria-label={handle.props.label} aria-expanded={open} aria-haspopup="dialog" data-selected={handle.props.selected || undefined} mix={[ref(node => { trigger = node }), on('click', () => {
      if (!popup || !trigger) return
      if (popup.matches(':popover-open')) popup.hidePopover()
      else { place(popup, trigger, handle.props.align ?? 'center'); popup.querySelector<HTMLElement>('input, button:not(:disabled), a')?.focus({ preventScroll: true }) }
    })]}>{handle.props.icon ? <Glyph name={handle.props.icon} /> : <><span>{handle.props.text ?? handle.props.label}</span><Glyph name="chevron-down" /></>}</button>
    <div class={handle.props.editing ? 'board-popup column-edit-popup' : 'board-popup'} popover="auto" role="dialog" aria-label={handle.props.label} mix={[ref(node => { popup = node }), on('toggle', () => { open = !!popup?.matches(':popover-open'); if (!open) handle.props.onClose?.(); handle.update() }), on('keydown', event => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return
      if (event.target instanceof HTMLInputElement) return
      let controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), a, input')]
      let index = controls.indexOf(document.activeElement as HTMLElement)
      let next = event.key === 'Home' ? 0 : event.key === 'End' ? controls.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + controls.length) % controls.length
      event.preventDefault(); controls[next]?.focus()
    })]}>{handle.props.children}</div>
  </div>
}
export function dismissPopup(event: Event) { (event.currentTarget as HTMLElement).closest<HTMLElement>('[popover]')?.hidePopover() }

export function ColumnMenu(handle: Handle<{ name: string; color: ColumnColor; canLeft: boolean; canRight: boolean; save(name: string, color: ColumnColor): void; move(direction: 'left' | 'right'): void; remove(): void }>) {
  let editing = false
  let color = handle.props.color
  let draftName = handle.props.name
  let nameInput: HTMLInputElement | undefined
  return () => <Popup label={`Column options for ${handle.props.name}`} icon="menu-dots-horizontal" className="lane-menu" align="start" editing={editing} onClose={() => { editing = false; handle.update() }}>
    {editing ? <form class="column-edit-form" mix={on('submit', event => {
      event.preventDefault()
      let name = String(new FormData(event.currentTarget).get('name') ?? '').trim()
      if (!name) return
      handle.props.save(name, color); dismissPopup(event); editing = false; handle.update()
    })}>
      <input class="input" name="name" aria-label="Column name" value={draftName} maxLength={100} required pattern=".*\S.*" mix={[ref(node => { if (nameInput === node) return; nameInput = node; requestAnimationFrame(() => { if (node.isConnected && node.closest(':popover-open')) { node.focus(); node.select() } }) }), on('input', event => { draftName = event.currentTarget.value })]} />
      <div class="column-colors" role="radiogroup" aria-label="Column color">
        {columnColors.map(value => <label class="column-color" title={value[0].toUpperCase() + value.slice(1)} style={{ backgroundColor: `var(--column-${value})` }}>
          <input type="radio" name="color" value={value} aria-label={value[0].toUpperCase() + value.slice(1)} checked={color === value} mix={on('change', () => { color = value; handle.update() })} />
          {color === value && <Glyph name="check" />}
        </label>)}
      </div>
      <button type="submit" class="column-save">Save changes</button>
    </form> : <div class="column-menu-options">
      <button type="button" class="popup-option" mix={on('click', async () => { draftName = handle.props.name; color = handle.props.color; editing = true; await handle.update(); nameInput?.focus(); nameInput?.select() })}><Glyph name="pencil" /><span>Edit column</span></button>
      <button type="button" class="popup-option" disabled={!handle.props.canLeft} mix={on('click', event => { dismissPopup(event); handle.props.move('left') })}><Glyph name="column-left" /><span>Move to the left</span></button>
      <button type="button" class="popup-option" disabled={!handle.props.canRight} mix={on('click', event => { dismissPopup(event); handle.props.move('right') })}><Glyph name="column-right" /><span>Move to the right</span></button>
      <button type="button" class="popup-option popup-negative" mix={on('click', event => { dismissPopup(event); handle.props.remove() })}><Glyph name="trash" /><span>Delete column</span></button>
    </div>}
  </Popup>
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
    return <Popup label={label} text={text} selected={value !== defaultValue && field !== 'sort'}>
      <strong class="popup-title">{label}</strong>
      {options.map(([id, name]) => <button type="button" class="popup-option" role="menuitemradio" aria-checked={value === id} mix={on('click', event => { change({ [field]: id }); dismissPopup(event) })}><span>{name}</span>{value === id && <Glyph name="check" />}</button>)}
    </Popup>
  }
  return () => {
    let { board, user, filters } = handle.props
    let tags = [...new Set(board.items.flatMap(item => item.detail?.tags ?? []))].sort()
    let active = filters.status !== 'all' || filters.tags.length || filters.assignee || filters.creator || filters.closer || filters.query || filters.sort !== 'latest'
    return <div class="board-toolbar" data-expanded={expanded || undefined}>
      <div class="board-filter-pill"><input class="board-search" type="search" placeholder="Filter these cards… [F]" aria-label="Filter cards" value={filters.query} mix={[ref(handle.props.searchRef), on('input', event => change({ query: event.currentTarget.value }))]} />
        {!expanded && <button type="button" aria-label="Card filters" aria-expanded="false" mix={on('click', toggle)}><Glyph name="filter" /></button>}
      </div>
      {expanded && <>
        <Popup label="Board…"><strong class="popup-title">Board…</strong>{error && <p role="alert">{error}</p>}{boards.map(option => <a class="popup-option" href={routes.dashboard.boards.show.href({ boardId: option.id })} data-rmx-document><span>{option.name}</span>{option.id === board.id && <Glyph name="check" />}</a>)}</Popup>
        {choice('Recently updated', 'sort', [['latest','Recently updated'],['newest','Newest to oldest'],['oldest','Oldest to newest']], 'latest')}
        {choice('Status…', 'status', [['all','All'],['open','Open'],['closed','Closed'],['not_now','Not now'],['pinned','Pinned'],['urgent','Urgent'],['snoozed','Snoozed']], 'all')}
        <Popup label="Tagged…" text={filters.tags.length ? filters.tags.map(tag => `#${tag}`).join(', ') : 'Tagged…'} selected={!!filters.tags.length}>
          <strong class="popup-title">Tagged…</strong>{!tags.length && <p class="popup-empty">No tags on this board yet.</p>}
          {tags.map(tag => <button type="button" class="popup-option" role="menuitemcheckbox" aria-checked={filters.tags.includes(tag)} mix={on('click', event => { change({ tags: filters.tags.includes(tag) ? filters.tags.filter(value => value !== tag) : [...filters.tags, tag] }); dismissPopup(event) })}><span>#{tag}</span>{filters.tags.includes(tag) && <Glyph name="check" />}</button>)}
        </Popup>
        {choice('Assigned to…','assignee',[['','Anyone'],['unassigned','No one'],[user.id,user.name]])}
        {choice('Added by…','creator',[['','Anyone'],[user.id,user.name]])}
        {choice('Closed by…','closer',[['','Anyone'],[user.id,user.name]])}
        <button type="button" class="board-filter-toggle" aria-label="Card filters" title="Collapse filter options" aria-expanded="true" mix={on('click', toggle)}><Glyph name="filter" /></button>
      </>}
      {!!active && <button type="button" class="board-clear-filters" mix={on('click', () => handle.props.onChange(defaultFilters()))}>Clear filters</button>}
    </div>
  }
}
