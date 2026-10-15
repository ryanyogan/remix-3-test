import type { Handle, RemixNode } from 'remix/component'
import { css } from 'remix/component'

import type { User } from '../../data/tables.ts'
import { routes } from '../../routes.ts'
import { themeStyle } from '../../ui/layout.tsx'
import { Document } from '../document.tsx'
import { UserMenu } from './public/user-menu.tsx'

// Account lives in the user menu, so it is a section without a nav entry.
const navItems = [
  { key: 'index', label: 'Overview', href: routes.dashboard.index.href() },
  { key: 'boards', label: 'Boards', href: routes.dashboard.boards.index.href() },
] as const

export type DashboardSection = (typeof navItems)[number]['key'] | 'account'

interface DashboardLayoutProps {
  user: User
  title: string
  current: DashboardSection
  // Full-bleed content with no page heading, for pages that render their own (the board).
  bleed?: boolean
  children?: RemixNode
}

// Shell shared by every page under routes.dashboard: header, nav, and content area.
export function DashboardLayout(handle: Handle<DashboardLayoutProps>) {
  return () => {
    let { user, title, current, bleed = false, children } = handle.props

    return (
      <Document title={`${title} · Dashboard`}>
        <div mix={[themeStyle, shellStyle]} style={bleed ? { height: '100vh' } : undefined}>
          <header mix={headerStyle}>
            <a href={routes.dashboard.index.href()} mix={brandStyle}>
              Dashboard
            </a>
            <nav aria-label="Dashboard" mix={navStyle}>
              {navItems.map((item) => (
                <a
                  key={item.key}
                  href={item.href}
                  aria-current={item.key === current ? 'page' : undefined}
                >
                  {item.label}
                </a>
              ))}
            </nav>
            <UserMenu user={user} />
          </header>
          {bleed ? (
            <main mix={bleedStyle}>{children}</main>
          ) : (
            <main mix={mainStyle}>
              <h1 mix={css({ margin: 0, fontSize: '20px' })}>{title}</h1>
              {children}
            </main>
          )}
        </div>
      </Document>
    )
  }
}

const shellStyle = css({ display: 'flex', flexDirection: 'column' })

const headerStyle = css({
  display: 'flex',
  alignItems: 'center',
  gap: '24px',
  height: '64px',
  flexShrink: 0,
  padding: '0 24px',
  background: 'var(--surface-3)',
  borderBottom: '1px solid color-mix(in srgb, var(--text-tertiary) 30%, transparent)',
  '@media (max-width: 600px)': { gap: '12px', padding: '0 16px' },
})

const brandStyle = css({
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.1em',
  color: 'inherit',
  textDecoration: 'none',
  '@media (max-width: 600px)': { display: 'none' },
})

const navStyle = css({
  display: 'flex',
  gap: '4px',
  '& a': {
    padding: '6px 12px',
    borderRadius: '8px',
    color: 'var(--text-tertiary)',
    textDecoration: 'none',
  },
  '& a:hover, & a:focus-visible': { color: 'var(--text-primary)', background: 'var(--surface-4)' },
  '& a[aria-current="page"]': { color: 'var(--brand-blue)', background: 'var(--surface-4)' },
})

const bleedStyle = css({ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' })

const mainStyle = css({
  width: '100%',
  maxWidth: '960px',
  margin: '0 auto',
  padding: '32px 24px',
  display: 'flex',
  flexDirection: 'column',
  gap: '24px',
  '@media (max-width: 600px)': { padding: '24px 16px' },
})
