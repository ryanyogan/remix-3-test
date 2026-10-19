import type { Handle, RemixNode } from 'remix/component'
import { css } from 'remix/component'

import { Document } from '../actions/document.tsx'
import { routes } from '../routes.ts'
import { ThemeToggle } from './public/theme-toggle.tsx'
import type { Theme } from './theme.ts'

// The Trellix wordmark: three bars and the name.
export function Logo() {
  return () => (
    <a href={routes.home.href()} class="logo">
      <span class="logo-mark" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      Trellix
    </a>
  )
}

// A centered panel page for small forms such as login and signup.
export function CardLayout(
  handle: Handle<{ title: string; theme?: Theme; children?: RemixNode }>,
) {
  return () => {
    let { title, theme, children } = handle.props

    return (
      <Document title={`${title} · Trellix`} theme={theme}>
        <header class="topbar">
          <Logo />
          <div class="topbar-tools">
            <ThemeToggle theme={theme} />
          </div>
        </header>
        <main class="page" mix={authPageStyle}>
          <div class="panel" mix={authPanelStyle}>
            <h1 class="page-title" mix={authTitleStyle}>
              {title}
            </h1>
            {children}
          </div>
        </main>
      </Document>
    )
  }
}

const authPageStyle = css({ alignItems: 'center' })

const authPanelStyle = css({
  width: '100%',
  maxWidth: '420px',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--s5)',
  padding: 'var(--s6)',
  '@media (max-width: 640px)': { padding: 'var(--s5)' },
})

const authTitleStyle = css({ fontSize: 'var(--text-heading)' })

export const formStyle = css({ display: 'flex', flexDirection: 'column', gap: 'var(--s4)' })

const fieldGroupStyle = css({ display: 'flex', flexDirection: 'column', gap: 'var(--s2)' })

// A labelled form field with its validation message linked by id. The input inside should use
// class="field" and point aria-describedby at `${id}-error` when there is an issue.
export function Field(
  handle: Handle<{ id: string; label: string; issue?: string; children: RemixNode }>,
) {
  return () => {
    let { id, label, issue, children } = handle.props

    return (
      <div mix={fieldGroupStyle}>
        <label htmlFor={id} class="label">
          {label}
        </label>
        {children}
        {issue && (
          <p id={`${id}-error`} class="field-error">
            {issue}
          </p>
        )}
      </div>
    )
  }
}

export const authSwitchStyle = css({
  margin: 0,
  textAlign: 'center',
  font: '400 var(--text-label) var(--font-body)',
  color: 'var(--ink-2)',
})
