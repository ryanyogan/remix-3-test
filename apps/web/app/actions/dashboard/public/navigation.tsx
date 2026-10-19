import { clientEntry, on, ref, type Handle } from 'remix/component'
import type { NavigationData } from '@trellix/contracts'
import { routes } from '../../../routes.ts'
import type { Theme } from '../../../ui/theme.ts'
import { ThemeToggle } from '../../../ui/public/theme-toggle.tsx'
import { BoardIcon, ChevronDownIcon, LogOutIcon, PinIcon, PlusIcon, UserIcon, XIcon } from '../../../ui/public/icons.tsx'
import { apiRequest } from '../boards/public/api-client.ts'

function HomeIcon() {
  return () => <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m3 10 9-8 9 8v11h-6v-7H9v7H3Z" /></svg>
}
function TagIcon() {
  return () => <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 3H11L2 12l10 10 9-9Z" /><circle cx="16.5" cy="7.5" r="1" /></svg>
}
export function isTyping(event: KeyboardEvent) {
  return event.target instanceof Element && !!event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), dialog[open]')
}

export const Navigation = clientEntry(import.meta.url, function Navigation(handle: Handle<{
  user: { id: string; name: string }; theme?: Theme; initial?: NavigationData; current: string
}>) {
  let data = handle.props.initial
  let dialog: HTMLDialogElement | undefined, input: HTMLInputElement | undefined, trigger: HTMLButtonElement | undefined
  let query = '', opened = false, loading = false, error = ''
  async function load() {
    if (data || loading) return
    loading = true; error = ''; handle.update()
    try { data = await apiRequest<NavigationData>('/navigation', 'GET', undefined, handle.signal) }
    catch (e) { if (!handle.signal.aborted) error = e instanceof Error ? e.message : 'Could not load navigation.' }
    finally { loading = false; if (!handle.signal.aborted) handle.update() }
  }
  function open() {
    query = ''; opened = true; handle.update()
    dialog?.showModal(); input?.focus(); void load()
  }
  function links() { return [...(dialog?.querySelectorAll<HTMLAnchorElement>('[data-jump-link]') ?? [])].filter(el => el.getClientRects().length) }
  function move(event: Pick<KeyboardEvent, 'key' | 'preventDefault'>) {
    if (event.key === 'Escape') { event.preventDefault(); dialog?.close(); return }
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return
    event.preventDefault()
    let items = links(), index = items.indexOf(document.activeElement as HTMLAnchorElement)
    items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus()
  }
  handle.queueTask(() => {
    document.addEventListener('keydown', event => {
      if (event.defaultPrevented || event.repeat || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || isTyping(event)) return
      if (event.key.toLowerCase() === 'c') {
        event.preventDefault()
        let boardId = /^\/dashboard\/(?:boards|cards)\/([^/]+)(?:\/|$)/.exec(location.pathname)?.[1]
        location.assign(routes.dashboard.cards.new.href() + (boardId && boardId !== 'new' ? `?board=${encodeURIComponent(decodeURIComponent(boardId))}` : ''))
      }
      if (event.key.toLowerCase() === 'b') { event.preventDefault(); location.assign(routes.dashboard.boards.new.href()) }
      if (event.key.toLowerCase() === 'p') { event.preventDefault(); location.assign('/dashboard?view=pinned') }
      if (event.key.toLowerCase() === 'n') { event.preventDefault(); location.assign(routes.dashboard.notifications.href()) }
      if (event.key.toLowerCase() === 'j') { event.preventDefault(); opened ? dialog?.close() : open() }
    }, { signal: handle.signal })
  })
  return () => {
    let { user, theme, current } = handle.props
    let term = query.trim().toLocaleLowerCase()
    let matches = (label: string) => !term || label.toLocaleLowerCase().includes(term)
    let boards = data?.boards.filter(b => matches(b.name)) ?? []
    let tags = data?.tags.filter(t => matches(t)) ?? []
    let shortcuts = [
      { label: 'Home', href: routes.dashboard.index.href(), icon: HomeIcon, current: current === 'index' },
      { label: 'Pinned cards', href: `${routes.dashboard.index.href()}?view=pinned`, icon: PinIcon, current: current === 'pinned' },
      { label: 'Added by me', href: `${routes.dashboard.index.href()}?view=added`, icon: UserIcon, current: current === 'added' },
    ]
    let settings = [
      { label: 'Account settings', href: routes.dashboard.account.href(), icon: UserIcon },
      { label: 'Insights', href: routes.dashboard.insights.href(), icon: BoardIcon },
      { label: 'API documentation', href: routes.apiGuide.href(), icon: BoardIcon },
    ].filter(item => matches(item.label))
    let hasResults = shortcuts.some(s => matches(s.label)) || boards.length || tags.length || matches(user.name) || settings.length || matches('Add a board') || matches('All boards') || matches('Sign out')
    return <>
      <button class="jump-trigger" type="button" aria-label="Open navigation" aria-haspopup="dialog" aria-expanded={opened} aria-controls="jump-navigation" aria-keyshortcuts="j" mix={[ref(node => { trigger = node }), on('click', open)]}>
        <span class="logo-mark" aria-hidden="true"><span /><span /><span /></span><strong>Trellix</strong><kbd>J</kbd><ChevronDownIcon />
      </button>
      <dialog id="jump-navigation" class="jump-dialog" aria-label="Jump to a board, person, place, or tag" mix={[
        ref(node => { dialog = node }), on('close', () => { opened = false; handle.update(); trigger?.focus() }),
        on('click', event => { if (event.target !== dialog) return; let r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close() }),
        on('keydown', move),
      ]}>
        <div class="jump-input-wrap">
          <input type="search" class="jump-input" aria-label="Filter navigation" placeholder="Type to jump to a board, person, place, or tag…" value={query} autoComplete="off" mix={[
            ref(node => { input = node }), on('input', async event => { query = event.currentTarget.value; await handle.update(); if (query) dialog?.querySelectorAll('details').forEach(section => { section.open = true }) }),
            on('keydown', event => {
              if (event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return
              if (!query && ['1', '2', '3'].includes(event.key)) { event.preventDefault(); location.assign(shortcuts[Number(event.key) - 1].href) }
              if (event.key === 'Enter') { event.preventDefault(); let link = links()[0]; if (link) location.assign(link.href) }
            }),
          ]} />
          <button class="jump-close icon-btn" type="button" aria-label="Close navigation" mix={on('click', () => dialog?.close())}><XIcon /></button>
        </div>
        <nav aria-label="Primary navigation" class="jump-content">
          <div class="jump-shortcuts">{shortcuts.map((item, index) => matches(item.label) && <a href={item.href} data-rmx-document data-jump-link aria-current={item.current ? 'page' : undefined}><kbd>{index + 1}</kbd><item.icon /><strong>{item.label}</strong></a>)}</div>
          {loading && <p class="jump-message" role="status">Loading your boards and tags…</p>}
          {error && <p class="jump-message" role="alert">{error} <button type="button" mix={on('click', () => { void load() })}>Try again</button></p>}
          {(boards.length > 0 || matches('Add a board') || matches('All boards')) && <details class="jump-section" open><summary>Boards</summary><div>
            {matches('Add a board') && <a href={routes.dashboard.boards.new.href()} data-rmx-document data-jump-link><PlusIcon />Add a board</a>}
            {boards.map(board => <a href={routes.dashboard.boards.show.href({ boardId: board.id })} data-rmx-document data-jump-link><BoardIcon />{board.name}</a>)}
            {matches('All boards') && <a href={routes.dashboard.boards.index.href()} data-rmx-document data-jump-link><BoardIcon />All boards</a>}
          </div></details>}
          {!!tags.length && <details class="jump-section" open><summary>Tags</summary><div>{tags.map(tag => <a href={`${routes.dashboard.index.href()}?tag=${encodeURIComponent(tag)}`} data-rmx-document data-jump-link><TagIcon />{tag}</a>)}</div></details>}
          {matches(user.name) && <details class="jump-section" open><summary>People</summary><div><a href={`${routes.dashboard.index.href()}?person=${encodeURIComponent(user.id)}`} data-rmx-document data-jump-link><UserIcon />{user.name}</a></div></details>}
          {(settings.length > 0 || matches('Sign out')) && <details class="jump-section" open><summary>Settings</summary><div>
            {settings.map(item => <a href={item.href} data-rmx-document data-jump-link><item.icon />{item.label}</a>)}
            {!term && <div class="jump-theme"><ThemeToggle theme={theme} /><span>Appearance</span></div>}
            {matches('Sign out') && <form action={routes.logout.href()} method="post" data-rmx-document><button type="submit"><LogOutIcon />Sign out</button></form>}
          </div></details>}
          {!hasResults && !loading && <p class="jump-message" role="status">Nothing matches “{query}”.</p>}
        </nav>
        <footer class="jump-footer"><strong>Trellix</strong><span>A little less planning. A little more doing.</span></footer>
      </dialog>
    </>
  }
})
