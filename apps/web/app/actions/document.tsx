import type { Handle, RemixNode } from 'remix/component'
import { ImportMap } from 'remix/component/server'

import { fontPreloads, scriptEntry, stylesheetHref } from '../assets.ts'
import type { Theme } from '../ui/theme.ts'

export interface DocumentProps {
  children?: RemixNode
  head?: RemixNode
  title?: string
  description?: string
  // The saved theme. Without one the page follows the OS.
  theme?: Theme
}

const DEFAULT_TITLE = 'Trellix'
const DEFAULT_DESCRIPTION =
  'Trellix is a simple kanban board for tracking work across columns, with progress at a glance.'

export function Document(handle: Handle<DocumentProps>) {
  return () => {
    let { children, head, title = DEFAULT_TITLE, description = DEFAULT_DESCRIPTION, theme } =
      handle.props
    let { href, importMap, preloads } = scriptEntry

    return (
      <html lang="en" data-theme={theme}>
        <head>
          <meta charSet="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <meta name="color-scheme" content="light dark" />
          <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
          <title>{title}</title>
          <meta name="description" content={description} />
          {fontPreloads.map((fontHref) => (
            <link
              key={fontHref}
              rel="preload"
              href={fontHref}
              as="font"
              type="font/woff2"
              crossOrigin="anonymous"
            />
          ))}
          <link rel="stylesheet" href={stylesheetHref} />
          {head}
          <ImportMap value={importMap} />
          {preloads.map((preloadHref) => (
            <link key={preloadHref} rel="modulepreload" href={preloadHref} />
          ))}
          <script type="module" src={href}></script>
        </head>
        <body>{children}</body>
      </html>
    )
  }
}
