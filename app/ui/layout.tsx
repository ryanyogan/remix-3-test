import type { Handle, RemixNode } from 'remix/component'
import { css } from 'remix/component'

import { Document } from '../actions/document.tsx'

const FONT_STACK =
  "'JetBrains Mono', ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace"

// A centered card page for small forms such as signup and account screens.
export function CardLayout(handle: Handle<{ title: string; children?: RemixNode }>) {
  return () => {
    let { title, children } = handle.props

    return (
      <Document title={title}>
        <main mix={[themeStyle, pageStyle]}>
          <div mix={cardStyle}>
            <h1 mix={css({ margin: 0, fontSize: '20px' })}>{title}</h1>
            {children}
          </div>
        </main>
      </Document>
    )
  }
}

// Shared design tokens and base typography for app pages.
export const themeStyle = css({
  '--surface-0': '#dee2e6',
  '--surface-3': '#f0f4f7',
  '--surface-4': '#f7fbff',
  '--text-primary': '#313539',
  '--text-tertiary': '#6c7074',
  '--brand-blue': '#2dacf9',
  '--danger': '#c92a2a',
  '@media (prefers-color-scheme: dark)': {
    '--surface-0': '#1e2226',
    '--surface-3': '#313539',
    '--surface-4': '#363a3e',
    '--text-primary': '#dee2e6',
    '--text-tertiary': '#94989c',
    '--danger': '#ff8787',
  },
  '& *, & *::before, & *::after': { boxSizing: 'border-box' },
  minHeight: '100vh',
  background: 'var(--surface-0)',
  color: 'var(--text-primary)',
  fontFamily: FONT_STACK,
  fontSize: '14px',
  lineHeight: 1.5,
})

const pageStyle = css({
  padding: '48px 16px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
})

const cardStyle = css({
  width: '100%',
  maxWidth: '400px',
  display: 'flex',
  flexDirection: 'column',
  gap: '24px',
  padding: '32px',
  borderRadius: '20px',
  background: 'var(--surface-3)',
})

export const fieldStyle = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
  '& input': {
    font: 'inherit',
    padding: '10px 12px',
    borderRadius: '8px',
    border: '1px solid var(--text-tertiary)',
    background: 'var(--surface-4)',
    color: 'var(--text-primary)',
  },
  '& input:focus-visible': { outline: '2px solid var(--brand-blue)', outlineOffset: '1px' },
  '& input[aria-invalid]': { borderColor: 'var(--danger)' },
})

export const errorStyle = css({ margin: 0, color: 'var(--danger)', fontSize: '13px' })

export const buttonStyle = css({
  font: 'inherit',
  fontWeight: 700,
  padding: '12px 16px',
  border: 0,
  borderRadius: '8px',
  cursor: 'pointer',
  background: 'var(--brand-blue)',
  color: '#fff',
  '&:focus-visible': { outline: '2px solid var(--text-primary)', outlineOffset: '2px' },
})

// A labelled form field with its validation message linked by id.
export function Field(
  handle: Handle<{ id: string; label: string; issue?: string; children: RemixNode }>,
) {
  return () => {
    let { id, label, issue, children } = handle.props

    return (
      <div mix={fieldStyle}>
        <label htmlFor={id}>{label}</label>
        {children}
        {issue && (
          <p id={`${id}-error`} mix={errorStyle}>
            {issue}
          </p>
        )}
      </div>
    )
  }
}

export const authSwitchStyle = css({
  margin: 0,
  color: 'var(--text-tertiary)',
  textAlign: 'center',
  '& a': { color: 'var(--brand-blue)' },
})
