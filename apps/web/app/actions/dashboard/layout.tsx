import type { Handle, RemixNode } from 'remix/component'
import { css } from 'remix/component'

import type { User } from '../../data/tables.ts'
import { routes } from '../../routes.ts'
import type { Theme } from '../../ui/theme.ts'
import { Document } from '../document.tsx'
import { Search } from './public/search.tsx'
import { Navigation } from './public/navigation.tsx'
import type { NavigationData } from '@trellix/contracts'
import { PinIcon } from '../../ui/public/icons.tsx'

export type DashboardSection = 'index' | 'boards' | 'account' | 'insights'

interface DashboardLayoutProps {
  user: User
  home?: boolean
  centered?: boolean
  card?: boolean
  view?: string
  navigation?: NavigationData
  theme?: Theme
  title: string
  current: DashboardSection
  // Shown under the page title, e.g. a mono summary line.
  meta?: RemixNode
  actions?: RemixNode
  // Full-bleed content with no page heading, for pages that render their own (the board). The
  // board controls the responsive scrolling layout.
  bleed?: boolean
  children?: RemixNode
}

// Shell shared by every page under routes.dashboard: top bar, nav, and content area.
export function DashboardLayout(handle: Handle<DashboardLayoutProps>) {
  return () => {
    let { user, theme, title, current, meta, actions, bleed = false, home = false, centered = false, card = false, navigation, view, children } = handle.props

    return (
      <Document title={`${title} · Trellix`} theme={theme}>
        <div class={card ? 'dashboard-shell card-page-shell' : centered ? 'dashboard-shell centered-shell' : home ? 'dashboard-shell home-shell' : bleed ? 'dashboard-shell board-shell' : 'dashboard-shell'}>
          <a class="skip-link" href="#main-content">Skip to main content</a>
          <header class="dashboard-header">
            <Navigation user={{ id: user.id, name: user.name }} theme={theme} initial={navigation} current={view || current} />
          </header>
          {card ? <main id="main-content" class="card-route-page">{children}</main> : centered ? <main id="main-content" class="centered-page">{children}</main> : bleed ? (
            <main id="main-content" class="board-main">{children}</main>
          ) : home ? <main id="main-content" class="home-page">{children}</main> : (
            <main id="main-content" class="page">
              <div class="page-heading"><div mix={headingStyle}>
                <h1 class="page-title">{title}</h1>
                {meta}
              </div>{actions}</div>
              {children}
            </main>
          )}
          <footer class="dashboard-dock" aria-label="Quick access">
            <a href={`${routes.dashboard.index.href()}?view=pinned`}><PinIcon /><span>Pinned</span><kbd>P</kbd></a>
            <Search dock />
            <a href={routes.dashboard.notifications.href()}><span>Notifications</span><kbd>N</kbd></a>
          </footer>
        </div>
      </Document>
    )
  }
}

const headingStyle = css({ display: 'flex', flexDirection: 'column', gap: 'var(--s3)' })
