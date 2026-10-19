import { clientEntry, on, ref, type Handle } from 'remix/component'
import { routes } from '../../../../routes.ts'
import { apiRequest } from './api-client.ts'

export const BoardSettings = clientEntry(import.meta.url, function BoardSettings(handle: Handle<{ board: { id: string; name: string } }>) {
  let error = '', saving = false
  let confirmation: HTMLDialogElement | undefined
  return () => <section class="board-settings-panel">
    <form method="post" action={routes.dashboard.boards.rename.href({ boardId: handle.props.board.id })} mix={on('submit', async event => {
      event.preventDefault(); if (saving) return
      let name = String(new FormData(event.currentTarget).get('name')).trim()
      if (!name) return
      saving = true; error = ''; handle.update()
      try { await apiRequest(`/boards/${handle.props.board.id}`, 'PATCH', { name }); location.assign(routes.dashboard.boards.show.href({ boardId: handle.props.board.id })) }
      catch (e) { error = e instanceof Error ? e.message : 'Could not save board'; saving = false; handle.update() }
    })}>
      <label for="board-settings-name">Name this board</label>
      <input class="field" id="board-settings-name" name="name" required maxLength={100} defaultValue={handle.props.board.name} />
      <button class="new-board-submit" type="submit" disabled={saving}>Save changes</button>
    </form>
    {error && <p role="alert">{error}</p>}
    <hr />
    <h2>Delete this board</h2><p>All cards, comments, and attachments in this board will be permanently deleted.</p>
    <button class="btn btn-danger" type="button" mix={on('click', () => confirmation?.showModal())}>Delete board</button>
    <dialog class="confirm-dialog" aria-labelledby="delete-board-heading" mix={ref(node => { confirmation = node })}>
      <h2 id="delete-board-heading">Delete “{handle.props.board.name}”?</h2><p>This permanently deletes the board and all its cards.</p>
      <form method="post" action={routes.dashboard.boards.destroy.href({ boardId: handle.props.board.id })} class="dialog-actions">
        <button type="button" class="btn btn-ghost" autoFocus mix={on('click', () => confirmation?.close())}>Keep board</button><button type="submit" class="btn btn-danger">Delete board</button>
      </form>
    </dialog>
  </section>
})
