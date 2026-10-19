import { clientEntry, on, ref, type Handle } from 'remix/component'
import { limits } from '../../../../data/limits.ts'
import { routes } from '../../../../routes.ts'
import { ArrowRightIcon, BoardIcon } from '../../../../ui/public/icons.tsx'
import { apiRequest } from './api-client.ts'

interface NewBoardFormProps {
  name?: string
  error?: string
}

export const NewBoardForm = clientEntry(import.meta.url, function NewBoardForm(handle: Handle<NewBoardFormProps>) {
  let error = handle.props.error
  let busy = false
  let nameInput: HTMLInputElement | undefined
  handle.queueTask(() => {
    nameInput?.focus()
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing || busy || document.querySelector('dialog[open], :popover-open')) return
      event.preventDefault()
      location.assign(routes.dashboard.index.href())
    }, { signal: handle.signal })
  })
  return () => <form method="post" action={routes.dashboard.boards.create.href()} data-rmx-document class="new-board-form" aria-busy={busy} mix={on('submit', async event => {
    event.preventDefault()
    if (busy) return
    let name = nameInput?.value.trim()
    if (!name) { error = 'Board names can’t be blank'; await handle.update(); nameInput?.focus(); return }
    busy = true; error = undefined; handle.update()
    try {
      let board = await apiRequest<{ id: string }>('/boards', 'POST', { name })
      location.assign(routes.dashboard.boards.show.href({ boardId: board.id }))
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not create the board.'
      busy = false; handle.update()
    }
  })}>
    <h1>Create a new board</h1>
    <label class="visually-hidden" htmlFor="board-name">Board name</label>
    <input id="board-name" name="name" class="new-board-name" placeholder="Name it…" required autoFocus autoComplete="off" maxLength={limits.name} defaultValue={handle.props.name} aria-invalid={error ? 'true' : undefined} aria-describedby={error ? 'board-name-error' : undefined} mix={[
      ref(node => { nameInput = node }),
      on('input', () => { if (error) { error = undefined; handle.update() } }),
    ]} />
    {error && <p id="board-name-error" role="alert" class="field-error">{error}</p>}
    <button type="submit" class="new-board-submit" disabled={busy}>{busy ? 'Creating…' : 'Create board'}<ArrowRightIcon /></button>
  </form>
})

export function NewBoardButton(handle: Handle<{ label?: string }>) {
  return () => <a href={routes.dashboard.boards.new.href()} data-rmx-document class="btn btn-primary new-board-trigger"><BoardIcon />{handle.props.label ?? 'New board'}<kbd>B</kbd></a>
}
