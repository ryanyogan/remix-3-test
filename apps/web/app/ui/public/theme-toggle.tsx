import * as toggle from '@remix-run/ui/toggle'
import { clientEntry } from 'remix/component'
import type { Handle } from 'remix/component'

import { routes } from '../../routes.ts'
import type { Theme } from '../theme.ts'
import { MoonIcon, SunIcon } from './icons.tsx'

// A "Dark theme" switch. Without JavaScript it is a form post that saves the opposite theme in a
// cookie. Enhanced, it flips <html data-theme> right away (the CSS animates the icon swap) and
// saves the cookie in the background.
export const ThemeToggle = clientEntry(
  import.meta.url,
  function ThemeToggle(handle: Handle<{ theme?: Theme }>) {
    let dark = handle.props.theme === 'dark'
    // With no saved theme the page follows the OS, which only the browser can see. Read it after
    // hydration so the first render matches the server's.
    if (!handle.props.theme) handle.queueTask(() => {
      if (!window.matchMedia('(prefers-color-scheme: dark)').matches) return
      dark = true
      handle.update()
    })

    async function setDark(next: boolean) {
      dark = next
      let theme: Theme = next ? 'dark' : 'light'
      document.documentElement.dataset.theme = theme
      handle.update()

      let body = new FormData()
      body.set('theme', theme)
      try {
        await fetch(routes.theme.href(), {
          method: 'POST',
          body,
          headers: { Accept: 'application/json' },
        })
      } catch (error) {
        // The page already shows the new theme; it just won't be remembered.
        console.error(error)
      }
    }

    return () => (
      <form method="post" action={routes.theme.href()}>
        <input type="hidden" name="theme" value={dark ? 'light' : 'dark'} />
        <button
          type="submit"
          class="theme-toggle"
          aria-label="Dark theme"
          mix={toggle.control({ checked: dark, onCheckedChange: setDark })}
        >
          <SunIcon class="sun" />
          <MoonIcon class="moon" />
        </button>
      </form>
    )
  },
)
