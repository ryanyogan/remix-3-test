import { on, ref, type Handle } from 'remix/component'

interface ActivityFilterProps {
  name: 'board' | 'person'
  value: string
  options: { value: string; label: string }[]
  onSelect: (value: string) => void
}

// A searchable, anchored picker. The native popover handles outside dismissal and
// keeps only one picker open; combobox focus stays in the filter while navigating.
export function ActivityFilter(handle: Handle<ActivityFilterProps>) {
  let trigger: HTMLButtonElement | undefined, panel: HTMLDivElement | undefined, input: HTMLInputElement | undefined
  let query = '', opened = false, active = -1
  let placement = { left: '12px', top: '12px', maxHeight: 'calc(100dvh - 24px)' }
  let id = `activity-${handle.props.name}`
  function options() {
    let term = query.trim().toLocaleLowerCase()
    return handle.props.options.filter(option => option.label.toLocaleLowerCase().includes(term))
  }
  function position() {
    if (!panel || !trigger || !opened) return
    let anchor = trigger.getBoundingClientRect()
    let width = panel.getBoundingClientRect().width || Number.parseFloat(getComputedStyle(panel).width)
    let left = `${Math.max(12, Math.min(innerWidth - width - 12, anchor.left + anchor.width / 2 - width / 2))}px`
    let top = Math.max(12, Math.min(anchor.bottom + 10, innerHeight - 160))
    let next = { left, top: `${top}px`, maxHeight: `${Math.max(140, innerHeight - top - 12)}px` }
    if (next.left !== placement.left || next.top !== placement.top || next.maxHeight !== placement.maxHeight) {
      placement = next; handle.update()
    }
  }
  function close(restoreFocus = false) { panel?.hidePopover(); if (restoreFocus) trigger?.focus() }
  async function move(delta: number) {
    let count = options().length
    if (!count) return
    active = active < 0 ? (delta > 0 ? 0 : count - 1) : (active + delta + count) % count
    await handle.update()
    panel?.querySelector(`#${id}-option-${active}`)?.scrollIntoView({ block: 'nearest' })
  }
  handle.queueTask(() => {
    window.addEventListener('resize', position, { signal: handle.signal })
    window.addEventListener('scroll', event => {
      if (opened && !(event.target instanceof Node && panel?.contains(event.target))) position()
    }, { capture: true, signal: handle.signal })
  })
  return () => {
    let { name, value, onSelect } = handle.props
    let matches = options()
    return <div id={id} class="activity-filter-popover" style={placement} popover="auto" role="dialog" aria-labelledby={`${id}-heading`} mix={[
        ref(node => { panel = node }),
        on('beforetoggle', event => {
          if (event.newState === 'open') {
            let source = document.getElementById(`${id}-trigger`)
            trigger = source instanceof HTMLButtonElement ? source : undefined
            query = ''; active = -1; opened = true; position(); handle.update()
          }
        }),
        on('toggle', event => {
          opened = event.newState === 'open'
          let source = document.getElementById(`${id}-trigger`)
          trigger = source instanceof HTMLButtonElement ? source : undefined
          trigger?.setAttribute('aria-expanded', String(opened))
          if (opened) { position(); input?.focus() }
          handle.update()
        }),
        on('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); close(true) } }),
        on('focusout', event => { if (event.relatedTarget instanceof Node && !panel?.contains(event.relatedTarget) && event.relatedTarget !== trigger) close() }),
      ]}>
        <h2 id={`${id}-heading`}>{name === 'board' ? 'Board…' : 'Person…'}</h2>
        <input class="activity-filter-input" type="search" role="combobox" list={undefined} aria-label={`Filter ${name === 'board' ? 'boards' : 'people'}`} aria-autocomplete="list" aria-expanded={opened} aria-controls={`${id}-options`} aria-activedescendant={active >= 0 && matches[active] ? `${id}-option-${active}` : undefined} placeholder="Filter…" autoFocus autoComplete="off" value={query} mix={[
          ref(node => { input = node }),
          on('input', event => { query = event.currentTarget.value; active = -1; handle.update() }),
          on('keydown', event => {
            if (event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); void move(event.key === 'ArrowDown' ? 1 : -1) }
            if (event.key === 'Enter' && matches[active < 0 ? 0 : active]) { event.preventDefault(); onSelect(matches[active < 0 ? 0 : active].value) }
          }),
        ]} />
        <div class="activity-filter-options" id={`${id}-options`} role="listbox" aria-label={name === 'board' ? 'Boards' : 'People'}>
          {matches.map((option, index) => <button key={option.value} type="button" role="option" id={`${id}-option-${index}`} tabIndex={-1} aria-selected={option.value === value} data-active={index === active ? '' : undefined} mix={on('click', () => onSelect(option.value))}>{option.label}</button>)}
        </div>
        {!matches.length && <p class="activity-filter-empty" role="status">{query ? `No ${name === 'board' ? 'boards' : 'people'} found.` : `No ${name === 'board' ? 'boards' : 'people'} yet.`}</p>}
      </div>
  }
}
