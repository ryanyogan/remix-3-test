// Maps an /assets/* URL path to the file it is stored at in Workers Static Assets. Package assets
// live under pnpm's .pnpm/ and node_modules/ directories, which asset uploads may skip, so those
// segments are renamed. Shared by the build script (writing) and the Worker (reading).
export function assetKey(pathname: string): string {
  return decodeURIComponent(pathname)
    .replaceAll('/.pnpm/', '/_pnpm/')
    .replaceAll('/node_modules/', '/_node_modules/')
}

const contentTypes: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.ts': 'text/javascript; charset=utf-8',
  '.tsx': 'text/javascript; charset=utf-8',
  '.jsx': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
}

// Compiled scripts keep their source extensions, so set the type browsers need for modules.
export function assetContentType(pathname: string): string | undefined {
  let extension = pathname.match(/\.[a-z]+$/i)?.[0].toLowerCase()
  return extension ? contentTypes[extension] : undefined
}
