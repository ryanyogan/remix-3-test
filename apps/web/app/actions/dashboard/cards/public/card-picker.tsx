import { on, ref, type Handle } from 'remix/component'
import { CheckIcon, PlusIcon } from '../../../../ui/public/icons.tsx'

interface PickerProps {
  id: string; title: string; shortcut?: string; placeholder?: string; label: string
  options: { value: string; label: string; selected?: boolean; shortcut?: string; search?: string }[]
  busy: boolean
  onSelect: (value: string) => void
  onCreate?: (value: string) => void
}

// Native popovers dismiss on Escape/outside click. Keep keyboard focus in the
// search field while navigating the filtered choices, as Fizzy does.
export function CardPicker(handle: Handle<PickerProps>) {
  let panel: HTMLDivElement | undefined, input: HTMLInputElement | undefined
  let query = '', active = 0, opened = false
  let placement = { left: '12px', top: '12px', maxHeight: 'calc(100dvh - 24px)' }
  function matches() { return handle.props.options.filter(o => `${o.label} ${o.search ?? ''}`.toLowerCase().includes(query.toLowerCase().trim())) }
  function trigger() { return document.getElementById(`${handle.props.id}-trigger`) }
  function position() {
    if (!opened || !panel) return
    let source = trigger(); let anchor = (handle.props.id === 'card-board' ? source?.closest('.perma-board-tab') : source)?.getBoundingClientRect(); if (!anchor) return
    let rect = panel.getBoundingClientRect()
    let top = anchor.bottom + 3
    if (top + rect.height > innerHeight - 12 && anchor.top > innerHeight / 2) top = Math.max(12, anchor.top - rect.height - 3)
    placement = { left: `${Math.max(12, Math.min(anchor.left, innerWidth - rect.width - 12))}px`, top: `${Math.max(12, top)}px`, maxHeight: `${Math.max(120, innerHeight - top - 12)}px` }
    handle.update()
  }
  function close() { panel?.hidePopover(); trigger()?.focus() }
  function choose(value: string) { if (!handle.props.busy) { handle.props.onSelect(value); close() } }
  function create() { if (query.trim() && !handle.props.busy) { handle.props.onCreate?.(query.trim().replace(/^#/, '')); close() } else input?.focus() }
  handle.queueTask(() => {
    window.addEventListener('resize', position, { signal: handle.signal })
    window.addEventListener('scroll', e => { if (!(e.target instanceof Node && panel?.contains(e.target))) position() }, { capture: true, signal: handle.signal })
  })
  return () => {
    let { id, title, shortcut, label, placeholder, busy, onCreate } = handle.props
    let options = matches()
    return <div id={id} class="card-picker" popover="auto" role="dialog" aria-labelledby={`${id}-heading`} style={placement} mix={[
      ref(node => { panel = node }),
      on('beforetoggle', e => { if (e.newState === 'open') { query = ''; active = 0; handle.update() } }),
      on('toggle', e => { opened = e.newState === 'open'; trigger()?.setAttribute('aria-expanded', String(opened)); if (opened) { position(); input?.focus() } }),
      on('keydown', async e => {
        let options = matches()
        if (e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return
        if (e.key === 'Escape') { e.preventDefault(); close() }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault(); let count = options.length + (onCreate ? 1 : 0)
          if (count) active = (active + (e.key === 'ArrowDown' ? 1 : count - 1)) % count
          await handle.update(); panel?.querySelector('[data-active]')?.scrollIntoView({ block: 'nearest' })
        }
        if (e.key === 'Enter' && e.target === input) { e.preventDefault(); if (onCreate && query.trim() && !options.some(o => o.value.toLowerCase() === query.trim().replace(/^#/, '').toLowerCase())) create(); else if (options[active]) choose(options[active].value); else if (onCreate) create() }
      }),
    ]}>
      <div class="card-picker-heading"><h2 id={`${id}-heading`}>{title}</h2>{shortcut && <kbd>{shortcut}</kbd>}</div>
      <input type="search" aria-label={label} placeholder={placeholder ?? 'Filter…'} autoComplete="off" value={query} aria-controls={`${id}-options`} mix={[ref(node => { input = node }), on('input', e => { query = e.currentTarget.value; active = 0; handle.update() })]} />
      <div id={`${id}-options`} class="card-picker-options">
        {options.map((option, index) => <button key={option.value} type="button" disabled={busy} aria-pressed={!!option.selected} data-active={active === index ? '' : undefined} mix={on('click', () => choose(option.value))}><span>{option.label}</span>{option.selected ? <CheckIcon /> : option.shortcut ? <kbd>{option.shortcut}</kbd> : null}</button>)}
        {onCreate && <button class="card-picker-create" type="button" disabled={busy} data-active={active === options.length ? '' : undefined} mix={on('click', create)}><PlusIcon /><span>Create tag</span></button>}
        {!options.length && !onCreate && <p class="card-picker-empty">No matches.</p>}
      </div>
    </div>
  }
}
