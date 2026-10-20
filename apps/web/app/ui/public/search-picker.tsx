import * as listbox from '@remix-run/ui/listbox'
import * as popover from '@remix-run/ui/popover'
import type { AnchorPlacement } from '@remix-run/ui/anchor'
import { attrs, on, ref, type Handle, type MixValue, type RemixNode } from 'remix/component'

import { PlusIcon } from './icons.tsx'

export interface SearchPickerOption {
  value: string
  label: string
  selected?: boolean
  // Extra text matched by the filter, such as a person's full name.
  search?: string
  // Shown after the label, such as a check mark or a shortcut.
  detail?: RemixNode
}

export interface SearchPickerProps {
  id: string
  // Skins the floating panel; the parts inside use the shared search-picker classes.
  class: string
  title: string
  label: string
  placeholder?: string
  shortcut?: string
  options: SearchPickerOption[]
  busy?: boolean
  multiple?: boolean
  placement?: AnchorPlacement
  empty?: (query: string) => string
  create?: { label: string; onCreate(text: string): void }
  onSelect(value: string): void
  // Renders the control that opens the picker: put `anchor` on the element the panel lines up
  // with and `trigger` on the button (often the same element).
  trigger(mix: { anchor: MixValue<HTMLElement>; trigger: MixValue<HTMLElement> }): RemixNode
}

const createValue = '\0create'

// The panel is phrasing content (spans), so a trigger can sit inside a heading or sentence.
// A button-opened panel with a filter field over a list of choices, as in Fizzy. Focus stays in
// the field while the arrow keys move through the list (aria-activedescendant); popover anchors,
// dismisses, and restores focus, and listbox owns highlighting and selection.
export function SearchPicker(handle: Handle<SearchPickerProps>) {
  let open = false, query = '', activeValue: string | null = null, refocus = false
  let list: listbox.ListboxRef | undefined, input: HTMLInputElement | undefined, button: HTMLElement | undefined

  // Stable ids, so aria-activedescendant is right in the same render that changes the options.
  function optionId(value: string | null) {
    if (value === null) return undefined
    if (value === createValue) return `${handle.props.id}-create`
    let index = handle.props.options.findIndex(option => option.value === value)
    return index < 0 ? undefined : `${handle.props.id}-option-${index}`
  }
  function text() { return query.trim().replace(/^#/, '') }
  function matches() {
    let term = query.trim().toLocaleLowerCase()
    return handle.props.options.filter(option =>
      `${option.label} ${option.search ?? ''}`.toLocaleLowerCase().includes(term))
  }
  function firstValue(options = matches()) {
    return options.find(option => option.selected)?.value ?? options[0]?.value
      ?? (handle.props.create ? createValue : null)
  }
  async function show() {
    if (open) return
    query = ''; activeValue = firstValue(); open = true
    // popover moves focus on its async toggle events. Move it as soon as the panel shows or
    // hides, so keys pressed meanwhile reach the field, or the trigger instead of a hidden field.
    await handle.update()
    if (open) input?.focus()
  }
  async function hide() {
    let focused = !!input && document.activeElement === input
    open = false
    await handle.update()
    if (open || !focused || (document.activeElement !== input && document.activeElement !== document.body)) return
    // A choice usually makes the parent busy, disabling the trigger; focus it once re-enabled.
    if (button?.matches(':disabled')) refocus = true
    else button?.focus()
  }
  function create() {
    let value = text()
    if (!value || handle.props.busy) return
    void hide(); handle.props.create?.onCreate(value)
  }
  function choose(value: string | null) {
    if (value === null || handle.props.busy) return
    if (value === createValue) return create()
    void hide(); handle.props.onSelect(value)
  }
  function submit() {
    let value = text().toLocaleLowerCase()
    let exact = handle.props.options.some(option => option.value.toLocaleLowerCase() === value)
    if (handle.props.create && value && !exact) create()
    else void list?.selectActive()
  }

  return () => {
    let { id, title, label, placeholder, shortcut, busy, multiple, create: creator, placement = 'bottom-start', empty, trigger } = handle.props
    let options = matches()
    let disabled = !!busy
    if (refocus && !busy) handle.queueTask(() => { refocus = false; button?.focus() })

    return <popover.Context>
      {trigger({
        anchor: popover.anchor({ placement, offset: 4 }),
        trigger: [
          ref(node => { button = node }),
          attrs({ 'aria-haspopup': 'dialog', 'aria-controls': id, 'aria-expanded': String(open) }),
          popover.focusOnHide(),
          on('click', show),
        ],
      })}
      <span id={id} class={`search-picker ${handle.props.class}`} role="dialog" aria-labelledby={`${id}-title`}
        mix={popover.surface({ open, onHide() { void hide() } })}>
        <span class="search-picker-heading"><span id={`${id}-title`} class="search-picker-title">{title}</span>{shortcut && <kbd>{shortcut}</kbd>}</span>
        <listbox.Context value={null} activeValue={activeValue} ref={listRef => { list = listRef }}
          onHighlight={value => { activeValue = value; handle.update() }}
          onSelect={choose}>
          <input class="search-picker-input" type="search" role="combobox" list={undefined} aria-label={label}
            aria-autocomplete="list" aria-expanded={open} aria-controls={`${id}-options`}
            aria-activedescendant={open ? optionId(activeValue) : undefined}
            placeholder={placeholder ?? 'Filter…'} autoComplete="off" value={query}
            mix={[
              ref(node => { input = node }),
              popover.focusOnShow(),
              on('input', event => {
                query = event.currentTarget.value; activeValue = firstValue(); handle.update()
              }),
              on('keydown', event => {
                if (event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return
                if (event.key === 'ArrowDown') { event.preventDefault(); list?.navigateNext() }
                if (event.key === 'ArrowUp') { event.preventDefault(); list?.navigatePrevious() }
                if (event.key === 'Enter') { event.preventDefault(); submit() }
              }),
            ]} />
          <span id={`${id}-options`} class="search-picker-options" aria-label={label}
            aria-multiselectable={multiple ? 'true' : undefined} mix={listbox.list()}>
            {options.map(option => <span key={option.value} id={optionId(option.value)} class="search-picker-option"
              aria-selected={option.selected ? 'true' : 'false'}
              mix={listbox.option({ value: option.value, label: option.label, disabled })}>
              <span>{option.label}</span>{option.detail}
            </span>)}
            {creator && <span key={createValue} id={optionId(createValue)} class="search-picker-option search-picker-create"
              aria-selected="false"
              mix={listbox.option({ value: createValue, label: creator.label, disabled })}>
              <PlusIcon /><span>{creator.label}</span>
            </span>}
          </span>
        </listbox.Context>
        {!options.length && !creator && <span class="search-picker-empty" role="status">{empty?.(query) ?? 'No matches.'}</span>}
      </span>
    </popover.Context>
  }
}
