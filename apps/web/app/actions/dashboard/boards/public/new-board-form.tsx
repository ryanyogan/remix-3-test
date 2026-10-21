import { clientEntry, navigate, on, ref, type Handle } from 'remix/component'
import { limits } from '../../../../data/limits.ts'
import { routes } from '../../../../routes.ts'
import { ArrowRightIcon, BoardIcon } from '../../../../ui/public/icons.tsx'

interface NewBoardFormProps {
  name?: string
  error?: string
}

export const NewBoardForm = clientEntry(import.meta.url, function NewBoardForm(handle: Handle<NewBoardFormProps>) {
  let error = handle.props.error
  let busy = false
  let nameInput: HTMLInputElement | undefined
  // The form submits through client navigation, which keeps this component mounted: a rejected
  // name comes back as new props.
  handle.frame.addEventListener('reloadComplete', () => {
    busy = false; error = handle.props.error; handle.update()
    if (error) nameInput?.focus()
  }, { signal: handle.signal })
  handle.queueTask(() => {
    nameInput?.focus()
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing || busy || document.querySelector('dialog[open], :popover-open')) return
      event.preventDefault()
      void navigate(routes.dashboard.index.href())
    }, { signal: handle.signal })
  })
  return () => <form method="post" action={routes.dashboard.boards.create.href()} class="new-board-form" aria-busy={busy} mix={on('submit', async event => {
    if (busy) { event.preventDefault(); return }
    let name = nameInput?.value.trim()
    if (!name) { event.preventDefault(); error = 'Board names can’t be blank'; await handle.update(); nameInput?.focus(); return }
    busy = true; error = undefined; handle.update()
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
  return () => <a href={routes.dashboard.boards.new.href()} class="btn btn-primary new-board-trigger"><BoardIcon />{handle.props.label ?? 'New board'}<kbd>B</kbd></a>
}
