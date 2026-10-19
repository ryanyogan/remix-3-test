import * as menu from '@remix-run/ui/menu'
import type { Handle } from 'remix/component'
import { clientEntry, navigate, ref } from 'remix/component'

import type { User } from '../../../data/tables.ts'
import { routes } from '../../../routes.ts'
import { ChevronDownIcon, LogOutIcon, UserIcon } from '../../../ui/public/icons.tsx'

// The user button and its menu (@remix-run/ui/menu: keyboard navigation, typeahead, focus
// return). Log out still posts the ordinary logout form.
export const UserMenu = clientEntry(
  import.meta.url,
  function UserMenu(handle: Handle<{ user: User }>) {
    let logoutForm: HTMLFormElement | undefined

    return () => {
      let { user } = handle.props

      return (
        <div
          mix={menu.onMenuSelect((event) => {
            if (event.item.name === 'account') void navigate(routes.dashboard.account.href())
            if (event.item.name === 'logout') logoutForm?.requestSubmit()
          })}
        >
          <menu.Context label={`Account menu for ${user.name}`}>
            <button
              type="button"
              class="user-btn"
              aria-label={`${user.name}, account menu`}
              mix={menu.trigger({ placement: 'bottom-end' })}
            >
              <span class="avatar" aria-hidden="true">
                {initials(user.name)}
              </span>
              <span class="user-name">{user.name}</span>
              <ChevronDownIcon />
            </button>
            <div class="menu" mix={menu.popover()}>
              <div class="menu-head">
                <strong>{user.name}</strong>
                <span class="mono">{user.email}</span>
                <span class="mono">
                  Member since {new Date(user.created_at).toISOString().slice(0, 10)}
                </span>
              </div>
              <div mix={menu.list()}>
                <div class="menu-item" mix={menu.item({ name: 'account', label: 'Account' })}>
                  <UserIcon />
                  Account
                </div>
                <div class="menu-item" mix={menu.item({ name: 'logout', label: 'Log out' })}>
                  <LogOutIcon />
                  Log out
                </div>
              </div>
            </div>
          </menu.Context>
          <form
            method="post"
            action={routes.logout.href()}
            hidden
            mix={ref((node) => (logoutForm = node))}
          />
        </div>
      )
    }
  },
)

function initials(name: string) {
  let parts = name.trim().split(/\s+/)
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}
