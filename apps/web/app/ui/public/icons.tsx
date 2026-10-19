import type { Handle, RemixNode } from 'remix/component'

// Lucide-style 24×24 stroke icons. They are decorative: the control around each one carries the
// accessible name. Size and stroke come from the theme's .icon class.
function icon(name: string, paths: () => RemixNode) {
  function Icon(handle: Handle<{ class?: string }>) {
    return () => (
      <svg
        class={handle.props.class ? `icon ${handle.props.class}` : 'icon'}
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        {paths()}
      </svg>
    )
  }
  Object.defineProperty(Icon, 'name', { value: `${name}Icon` })
  return Icon
}

export const SunIcon = icon(
  'Sun',
  () => <>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2m-7.07-17.07 1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
  </>,
)

export const MoonIcon = icon('Moon', () => <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />)

export const ChevronDownIcon = icon('ChevronDown', () => <path d="m6 9 6 6 6-6" />)

export const ChevronLeftIcon = icon('ChevronLeft', () => <path d="m15 18-6-6 6-6" />)

export const PlusIcon = icon('Plus', () => <path d="M5 12h14M12 5v14" />)

export const CheckIcon = icon('Check', () => <path d="M20 6 9 17l-5-5" />)

export const CircleCheckIcon = icon(
  'CircleCheck',
  () => <>
    <circle cx="12" cy="12" r="10" />
    <path d="m9 12 2 2 4-4" />
  </>,
)

export const ArrowRightIcon = icon('ArrowRight', () => <path d="M5 12h14m-7-7 7 7-7 7" />)

export const PaperclipIcon = icon(
  'Paperclip',
  () => <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />,
)

export const TrashIcon = icon(
  'Trash',
  () => <path d="M3 6h18m-2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m-6 5v6m4-6v6" />,
)

export const XIcon = icon('X', () => <path d="M18 6 6 18M6 6l12 12" />)

export const UserIcon = icon(
  'User',
  () => <>
    <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </>,
)

export const LogOutIcon = icon(
  'LogOut',
  () => <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4m7 14 5-5-5-5m5 5H9" />,
)

export const PinIcon = icon('Pin', () => <path d="m16 3 5 5-4 2-3 5-2-2-5 5m5-5-3-3 5-3 2-4Z" />)
export const CommentIcon = icon('Comment', () => <path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-1 1V12a9 9 0 0 1 18-.5Z" />)
export const TextIcon = icon('Text', () => <path d="M4 6h16M4 12h16M4 18h10" />)
export const CollapseIcon = icon('Collapse', () => <path d="M4 4v16m8-14-6 6 6 6m8-12-6 6 6 6" />)

export const BoardIcon = icon('Board', () => <><rect x="3" y="3" width="18" height="18" rx="1" /><path d="M9 3v18M3 8h18M3 13h18M3 18h18" /></>)
