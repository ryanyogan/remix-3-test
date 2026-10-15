import type { Handle } from 'remix/component'
import { clientEntry, css } from 'remix/component'

import type { User } from '../../../data/tables.ts'
import { routes } from '../../../routes.ts'

const MENU_ID = 'user-menu'

// Native popover: open/close, Escape, and click-outside dismissal work without client JS.
// Hydrated only to close the menu when an in-page navigation starts, since the
// browser runtime patches the page in place and would otherwise leave it open.
export const UserMenu = clientEntry(
  import.meta.url,
  function UserMenu(handle: Handle<{ user: User }>) {
    handle.frame.addEventListener(
      'reloadStart',
      () => document.getElementById(MENU_ID)?.hidePopover(),
      { signal: handle.signal },
    )

    return () => {
      let { user } = handle.props

      return (
        <div mix={css({ marginLeft: 'auto' })}>
          <button type="button" popovertarget={MENU_ID} aria-haspopup="menu" mix={triggerStyle}>
            <span aria-hidden="true" mix={avatarStyle}>
              {initials(user.name)}
            </span>
            <span mix={css({ '@media (max-width: 600px)': { display: 'none' } })}>{user.name}</span>
            <span aria-hidden="true">▾</span>
          </button>
          <div id={MENU_ID} popover="auto" mix={menuStyle}>
            <div mix={css({ padding: '12px 16px' })}>
              <p mix={css({ margin: 0, fontWeight: 700 })}>{user.name}</p>
              <p mix={css({ margin: 0, color: 'var(--text-tertiary)', overflowWrap: 'anywhere' })}>
                {user.email}
              </p>
              <p mix={css({ margin: '8px 0 0', color: 'var(--text-tertiary)', fontSize: '12px' })}>
                Member since {new Date(user.created_at).toISOString().slice(0, 10)}
              </p>
            </div>
            <hr mix={dividerStyle} />
            <a href={routes.dashboard.account.href()} mix={itemStyle}>
              Account
            </a>
            <form method="post" action={routes.logout.href()}>
              <button type="submit" mix={itemStyle}>
                Log out
              </button>
            </form>
          </div>
        </div>
      )
    }
  },
)

function initials(name: string) {
  let parts = name.trim().split(/\s+/)
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

const triggerStyle = css({
  font: 'inherit',
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  padding: '4px 8px 4px 4px',
  border: 0,
  borderRadius: '999px',
  cursor: 'pointer',
  background: 'transparent',
  color: 'var(--text-primary)',
  '&:hover, &:focus-visible': { background: 'var(--surface-4)' },
  '&:focus-visible': { outline: '2px solid var(--brand-blue)' },
})

const avatarStyle = css({
  width: '32px',
  height: '32px',
  borderRadius: '50%',
  display: 'grid',
  placeItems: 'center',
  fontWeight: 700,
  fontSize: '12px',
  background: 'var(--brand-blue)',
  color: '#fff',
})

const menuStyle = css({
  // Popovers render in the top layer; pin this one under the header's right edge.
  position: 'fixed',
  inset: 'unset',
  top: '60px',
  right: '16px',
  width: '260px',
  margin: 0,
  padding: '4px 0',
  border: '1px solid color-mix(in srgb, var(--text-tertiary) 30%, transparent)',
  borderRadius: '12px',
  background: 'var(--surface-3)',
  color: 'var(--text-primary)',
  boxShadow: '0 12px 32px rgb(0 0 0 / 0.18)',
  '& form': { margin: 0 },
})

const dividerStyle = css({
  margin: '4px 0',
  border: 0,
  borderTop: '1px solid color-mix(in srgb, var(--text-tertiary) 30%, transparent)',
})

const itemStyle = css({
  display: 'block',
  width: '100%',
  padding: '8px 16px',
  font: 'inherit',
  textAlign: 'left',
  border: 0,
  background: 'transparent',
  color: 'inherit',
  textDecoration: 'none',
  cursor: 'pointer',
  '&:hover, &:focus-visible': { background: 'var(--surface-4)', outline: 'none' },
})
