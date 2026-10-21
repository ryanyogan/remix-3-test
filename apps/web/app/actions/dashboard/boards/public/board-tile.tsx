import { routes } from '../../../../routes.ts'
import { clientEntry, on, ref, type Handle } from 'remix/component'
import type { WorkspaceBoard } from '@trellix/contracts'
import { ArrowRightIcon, TrashIcon } from '../../../../ui/public/icons.tsx'
import { appRequest } from '../../public/app-request.ts'

export const BoardTile = clientEntry(import.meta.url, function BoardTile(handle: Handle<{ board: WorkspaceBoard; index: number; compact?: boolean }>) {
  let dialog: HTMLDialogElement | undefined
  let busy = false
  let error = ''
  let removed = false
  return () => {
    let { board, compact } = handle.props
    if (removed) return null
    return <div class="project-tile">
      <a class="project-link" href={routes.dashboard.boards.show.href({ boardId: board.id })}>
        <span class="project-heading"><span class="project-mark" aria-hidden="true"><i /><i /><i /></span><strong>{board.name}</strong><ArrowRightIcon /></span>
        {!compact && <span class="project-preview">{board.previews.length ? board.previews.map(card => <span key={card.id}><i />{card.title}</span>) : <span class="project-preview-empty">Your next good idea goes here.</span>}</span>}
        <span class="project-footer"><span>{board.total - board.done} open <span class="project-divider">/</span> {board.done} done</span><span class="project-progress" aria-label={`${board.done} of ${board.total} cards done`}><i style={{ width: `${board.total ? board.done / board.total * 100 : 0}%` }} /></span></span>
      </a>
      {!compact && <button type="button" class="icon-btn project-delete" aria-label={`Delete board "${board.name}"`} mix={on('click', () => dialog?.showModal())}><TrashIcon /></button>}
      <dialog class="confirm-dialog" aria-labelledby={`delete-board-${board.id}`} mix={ref(node => { dialog = node })}>
        <h2 id={`delete-board-${board.id}`}>Delete “{board.name}”?</h2><p>Its {board.total} cards, comments, and attachments will be permanently deleted.</p>
        {error && <p class="field-error" role="alert">{error}</p>}
        <div class="dialog-actions"><button type="button" class="btn btn-ghost" disabled={busy} autoFocus mix={on('click', () => dialog?.close())}>Keep board</button><button type="button" class="btn btn-danger" disabled={busy} mix={on('click', async () => {
          busy = true; error = ''; handle.update()
          try { await appRequest(routes.dashboard.boards.destroy.href({ boardId: board.id }), 'POST'); dialog?.close(); removed = true; await handle.frame.reload() }
          catch (e) { error = e instanceof Error ? e.message : 'Could not delete this board.' }
          finally { busy = false; handle.update() }
        })}>{busy ? 'Deleting…' : 'Delete board'}</button></div>
      </dialog>
    </div>
  }
})
