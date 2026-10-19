import { clientEntry, on, ref, unsafeHTML, type Handle } from 'remix/component'
import type { BoardData, CardDetailData, NavigationData } from '@trellix/contracts'
import { routes } from '../../../../routes.ts'
import { limits } from '../../../../data/limits.ts'
import { ArrowRightIcon, ChevronDownIcon, PinIcon, PlusIcon, XIcon, PaperclipIcon } from '../../../../ui/public/icons.tsx'
import { appRequest } from '../../public/app-request.ts'
import { isTyping } from '../../public/navigation.tsx'
import { RichEditor, plainHtml } from './rich-editor.tsx'
import { CardPicker } from './card-picker.tsx'
import { TagIcon, ImageIcon, RemoveImageIcon, AssignIcon } from './card-icons.tsx'

function TicketIcon() { return () => <svg viewBox="0 0 24 24" class="icon" aria-hidden="true"><path d="M3 5h18v5a2 2 0 0 0 0 4v5H3v-5a2 2 0 0 0 0-4Z" fill="currentColor" stroke="none"/><path d="m12 6 1.7 4.1 4.3.4-3.3 2.8 1 4.2-3.7-2.3-3.7 2.3 1-4.2L6 10.5l4.3-.4Z" fill="var(--surface)" stroke="none"/></svg> }
function BellIcon() { return () => <svg viewBox="0 0 24 24" class="icon" aria-hidden="true"><path d="M12 2v2M6 10a6 6 0 0 1 12 0v6l2 3H4l2-3Zm4 12h4"/><path d="M6 10a6 6 0 0 1 12 0v6l2 3H4l2-3Z" fill="currentColor"/></svg> }
function RefreshIcon() { return () => <svg viewBox="0 0 24 24" class="icon" aria-hidden="true"><path d="M20 11a8 8 0 0 0-14-5L3 9m0-6v6h6M4 13a8 8 0 0 0 14 5l3-3m0 6v-6h-6"/></svg> }
function initials(name: string) { return name.trim().split(/\s+/).map(p => p[0]).slice(0, 2).join('').toUpperCase() }
function age(at: number) { let days = Math.max(0, Math.floor((Date.now() - at) / 86400000)); return days === 0 ? 'today' : `${days} ${days === 1 ? 'day' : 'days'} ago` }

interface CardPageProps {
  user: { id: string; name: string }
  boards: NavigationData['boards']
  tags: string[]
  board?: BoardData
  detail?: CardDetailData
  initialColumn?: string
}

export const CardPage = clientEntry(import.meta.url, function CardPage(handle: Handle<CardPageProps>) {
  let board = handle.props.board
  let detail = handle.props.detail
  let editing = !detail
  let busy = false, error = '', editorReady = false, editorUploading = false, commentUploading = false
  let title = detail?.title ?? ''
  let description = detail?.description_html || plainHtml(detail?.description ?? '')
  let comment = '', commentBlank = true, commentVersion = 0
  let draftTags: string[] = [], assigneeId: string | null = null
  let draftSteps: { id: string; title: string; completed: number }[] = []
  let coverFile: File | undefined, coverPreview = '', coverInput: HTMLInputElement | undefined
  // Reuse this id after a failed upload/response so retries cannot duplicate a card.
  let creationId: string | undefined, created = false
  let editForm: HTMLFormElement | undefined, commentForm: HTMLFormElement | undefined
  let params = () => ({ boardId: board!.id, cardId: detail!.id })
  let back = () => board ? routes.dashboard.boards.show.href({ boardId: board.id }) : routes.dashboard.index.href()
  async function change(href: string, body?: unknown) {
    if (busy || !detail) return false
    busy = true; error = ''; handle.update()
    try {
      await appRequest(href, 'POST', body)
      detail = await appRequest<CardDetailData>(routes.dashboard.cards.data.href(params()))
      return true
    } catch (e) { error = e instanceof Error ? e.message : 'Could not save that change.'; return false }
    finally { busy = false; handle.update() }
  }
  function edit() {
    if (busy || !detail || editing) return
    title = detail.title; description = detail.description_html || plainHtml(detail.description)
    editing = true; editorReady = false; editorUploading = false; handle.update()
  }
  function cancel() {
    if (busy) return
    if (detail && editing) { editing = false; editorUploading = false; handle.update() }
    else location.assign(back())
  }
  async function save(addAnother = false) {
    if (busy || !board || !editorReady || editorUploading) return
    if (detail) {
      if (await change(routes.dashboard.cards.update.href(params()), { title: title.trim() || 'Untitled', descriptionHtml: description })) { editing = false; handle.update() }
    } else {
      if (!board.columns.length) { error = 'Add a column to this board before creating a card.'; handle.update(); return }
      busy = true; error = ''; handle.update()
      try {
        creationId ??= crypto.randomUUID()
        let payload = { id: creationId, title: title.trim() || 'Untitled', columnId: board.columns.find(c => c.id === handle.props.initialColumn)?.id ?? (board.columns.find(column => column.name.toLowerCase() !== 'not now') ?? board.columns[0]).id, descriptionHtml: description, tags: draftTags, assigneeId, steps: draftSteps.map(step => ({ title: step.title, completed: !!step.completed })) }
        await appRequest(routes.dashboard.cards.create.href({ boardId: board.id }), 'POST', payload)
        created = true
        if (coverFile) await uploadCover(creationId, coverFile)
        location.assign(addAnother ? `${routes.dashboard.cards.new.href()}?board=${board.id}` : back())
      } catch (e) { busy = false; error = e instanceof Error ? e.message : 'Could not create the card.'; handle.update() }
    }
  }
  async function uploadCover(cardId: string, file: File) {
    let body = new FormData(); body.set('file', file)
    let response = await fetch(routes.dashboard.cards.setCover.href({ boardId: board!.id, cardId }), { method: 'POST', body, headers: { Accept: 'application/json' } })
    if (!response.ok) throw new Error((await response.json()).error ?? 'Could not upload the image.')
  }
  async function chooseCover(file?: File) {
    if (!file || busy) return
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || !file.size || file.size > limits.fileBytes) {
      error = `Choose a PNG, JPEG, or WebP image of at most ${limits.fileLabel}.`; handle.update(); return
    }
    error = ''; busy = true; handle.update()
    try {
      // Decode before showing it so corrupt images never become broken previews.
      let bitmap = await createImageBitmap(file); bitmap.close()
      if (detail) { await uploadCover(detail.id, file); detail = await appRequest<CardDetailData>(routes.dashboard.cards.data.href(params())) }
      else { if (coverPreview) URL.revokeObjectURL(coverPreview); coverFile = file; coverPreview = URL.createObjectURL(file) }
    } catch (e) { error = e instanceof Error ? e.message : 'Could not load the image.' }
    finally { busy = false; handle.update() }
  }
  async function removeCover() {
    if (detail) await change(routes.dashboard.cards.removeCover.href(params()))
    else { if (coverPreview) URL.revokeObjectURL(coverPreview); coverPreview = ''; coverFile = undefined; handle.update() }
  }
  async function selectBoard(id: string) {
    if (busy || id === board?.id) return
    busy = true; error = ''; handle.update()
    try {
      if (detail) {
        await appRequest(routes.dashboard.cards.update.href(params()), 'POST', { boardId: id })
        location.assign(routes.dashboard.cards.show.href({ boardId: id, cardId: detail.id }))
      } else if (!created) board = await appRequest<BoardData>(routes.dashboard.boards.data.href({ boardId: id }))
    } catch (e) { error = e instanceof Error ? e.message : 'Could not change boards.' }
    finally { busy = false; handle.update() }
  }
  async function tag(value: string) {
    value = value.trim().replace(/^#/, '').toLowerCase()
    let current = detail?.tags ?? draftTags
    let next = current.includes(value) ? current.filter(t => t !== value) : [...current, value]
    if (!value || next.length > 12) { error = 'Use up to 12 tags.'; handle.update(); return }
    if (detail) await change(routes.dashboard.cards.update.href(params()), { tags: next })
    else { draftTags = next; handle.update() }
  }
  async function assign() {
    let next = (detail?.assignee_id ?? assigneeId) ? null : handle.props.user.id
    if (detail) await change(routes.dashboard.cards.update.href(params()), { assigneeId: next })
    else { assigneeId = next; handle.update() }
  }
  function openPicker(id: string) { document.getElementById(id)?.showPopover() }
  handle.signal.addEventListener('abort', () => { if (coverPreview) URL.revokeObjectURL(coverPreview) }, { once: true })
  function toggleDone() {
    if (!detail || !board || board.columns.length < 2) return
    let last = board.columns.at(-1)!
    void change(routes.dashboard.cards.update.href(params()), { columnId: detail.column_id === last.id ? (board.columns.find(column => column.name.toLowerCase() !== 'not now') ?? board.columns[0]).id : last.id })
  }
  handle.queueTask(() => document.addEventListener('keydown', event => {
    if (event.defaultPrevented || event.isComposing || event.repeat || document.querySelector('dialog[open], :popover-open')) return
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      if (commentForm?.contains(event.target as Node)) { event.preventDefault(); commentForm.requestSubmit() }
      else if (editing) { event.preventDefault(); void save(event.shiftKey && !detail) }
      return
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return
    if (event.key === 'Escape') {
      if (commentForm?.contains(event.target as Node)) { (event.target as HTMLElement).blur(); return }
      event.preventDefault(); cancel(); return
    }
    if (isTyping(event)) return
    if (event.key.toLowerCase() === 't') { event.preventDefault(); openPicker('card-tags') }
    if (event.key.toLowerCase() === 'a') { event.preventDefault(); openPicker('card-assign') }
    if (event.key.toLowerCase() === 'm') { event.preventDefault(); void assign() }
    if (event.key.toLowerCase() === 'e') { event.preventDefault(); edit() }
    if (event.key.toLowerCase() === 'd' && !editing) { event.preventDefault(); toggleDone() }
  }, { signal: handle.signal }))

  return () => {
    let { user, boards } = handle.props
    let selectedTags = detail?.tags ?? draftTags
    let steps = detail?.steps ?? draftSteps
    let assigned = detail ? detail.assignee_id : assigneeId
    let cover = detail?.cover_file_id ? `${routes.dashboard.cards.cover.href(params())}?v=${detail.cover_file_id}` : coverPreview
    let done = detail && board && board.columns.length > 1 && detail.column_id === board.columns.at(-1)?.id
    return <>
      <a class="card-route-back" href={back()} data-rmx-document>Back to {board?.name ?? 'Home'}<kbd>ESC</kbd></a>
      {!board ? <div class="card-route-empty"><h1>Add your first board</h1><p>Cards need a board to call home.</p><a class="home-action" href={routes.dashboard.boards.new.href()} data-rmx-document>Add a board <ArrowRightIcon /></a></div> : <>
        <section class={detail ? "perma" : "perma perma-draft"} aria-label={detail ? 'Card' : 'New card'}>
          <aside class="perma-tools perma-tools-left" aria-label="Card appearance">
            {detail && <button class="perma-circle" type="button" disabled title="Golden tickets are not available yet" aria-label="Promote to Golden Ticket (not available yet)"><TicketIcon /></button>}
            <button class="perma-circle" type="button" disabled={busy} title={cover ? 'Remove background image' : 'Add background image'} aria-label={cover ? 'Remove background image' : 'Add background image'} mix={on('click', () => { if (cover) void removeCover(); else coverInput?.click() })}>{cover ? <RemoveImageIcon /> : <ImageIcon />}</button>
            <input class="visually-hidden" type="file" tabIndex={-1} accept="image/png,image/jpeg,image/webp" aria-label="Background image file" mix={[ref(node => { coverInput = node }), on('change', event => { void chooseCover(event.currentTarget.files?.[0]); event.currentTarget.value = '' })]} />
          </aside>
          <div class="perma-frame">
            <article class="perma-paper">
              {cover && <img class="perma-background" src={cover} alt="" />}
              <header class="perma-header">
                <div class="perma-board-tab"><span class="perma-number">{detail ? <><span>No.</span> {detail.id.slice(0, 6).toUpperCase()}</> : 'New card'}</span>
                  <button class="perma-board-name" type="button" id="card-board-trigger" popoverTarget="card-board" aria-label="Card board" aria-haspopup="dialog" aria-expanded="false" disabled={busy || created}>{board.name}<ChevronDownIcon /></button>
                </div>
                <button class="perma-circle perma-tag-button" type="button" id="card-tags-trigger" aria-label="Edit tags" popoverTarget="card-tags" aria-haspopup="dialog" aria-expanded="false" disabled={busy}><TagIcon /></button>
                {selectedTags.map(tag => <span class="perma-tag" key={tag}>#{tag}</span>)}
                <CardPicker id="card-board" title="Move this card to…" label="Filter boards" busy={busy} options={boards.map(b => ({ value: b.id, label: b.name, selected: b.id === board!.id }))} onSelect={id => { void selectBoard(id) }} />
                <CardPicker id="card-tags" title="Tag this…" shortcut="T" label="Add tag" placeholder="Add a new tag or filter…" busy={busy} options={[...new Set([...selectedTags, ...handle.props.tags])].map(t => ({ value: t, label: `#${t}`, selected: selectedTags.includes(t) }))} onSelect={value => { void tag(value) }} onCreate={value => { if (!selectedTags.includes(value.toLowerCase())) void tag(value) }} />
              </header>
              <div class="perma-body">
                <div class="perma-content">
                  {editing ? <form id="card-edit-form" class="perma-edit" key="editing" mix={[ref(node => { editForm = node }), on('submit', event => { event.preventDefault(); void save() })]}>
                    <label class="visually-hidden" htmlFor="card-title">Card title</label>
                    <textarea id="card-title" class="perma-title-input" aria-label="Card title" placeholder="Name it…" rows={1} maxLength={limits.cardTitle} defaultValue={title} mix={[ref(node => { node.focus() }), on('input', event => { title = event.currentTarget.value }), on('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); void save() } })]} />
                    <RichEditor value={description} label="Card description" placeholder="Add some notes, context, pictures, or video about this…" onChange={value => { description = value }} onReady={() => { editorReady = true; handle.update() }} onUploading={blocked => { editorUploading = blocked; handle.update() }} />
                  </form> : <div class="perma-story" key="story"><h1 id="card-detail-heading"><button type="button" mix={on('click', edit)}>{detail!.title}</button></h1>
                    {detail!.description_html ? <div class="lexxy-content perma-description" innerHTML={unsafeHTML(detail!.description_html)} /> : detail!.description ? <div class="perma-description plain-description">{detail!.description}</div> : null}
                  </div>}
                  <section class="perma-steps" aria-label="Steps">
                    {steps.map(step => <div class="perma-step" key={step.id}><label><input type="checkbox" checked={!!step.completed} disabled={busy} mix={on('change', e => { if (detail) void change(routes.dashboard.cards.updateStep.href({ ...params(), stepId: step.id }), { completed: e.currentTarget.checked }); else { draftSteps = draftSteps.map(s => s.id === step.id ? { ...s, completed: e.currentTarget.checked ? 1 : 0 } : s); handle.update() } })}/><span class={step.completed ? 'step-complete' : ''}>{step.title}</span></label><button type="button" class="perma-remove-step" aria-label={`Delete step ${step.title}`} disabled={busy} mix={on('click', () => { if (detail) void change(routes.dashboard.cards.removeStep.href({ ...params(), stepId: step.id })); else { draftSteps = draftSteps.filter(s => s.id !== step.id); handle.update() } })}><XIcon /></button></div>)}
                    <form class="perma-step-form" mix={on('submit', async event => {
                      event.preventDefault(); let form = event.currentTarget; let title = String(new FormData(form).get('title')).trim(); if (!title) return
                      if (detail) { if (await change(routes.dashboard.cards.addStep.href(params()), { title })) form.reset() }
                      else if (draftSteps.length < 200) { draftSteps = [...draftSteps, { id: crypto.randomUUID(), title, completed: 0 }]; form.reset(); handle.update() }
                    })}><span class="perma-step-box" aria-hidden="true"/><input name="title" aria-label="New step" placeholder="Add a step…" required maxLength={300} disabled={busy} /><button type="submit" aria-label="Add step" disabled={busy}><PlusIcon /></button></form>
                  </section>
                </div>
                {detail && <nav class="perma-stages" aria-label="Card status">{board.columns.map(column => <button key={column.id} type="button" class={detail!.column_id === column.id ? 'perma-stage current' : 'perma-stage'} aria-current={detail!.column_id === column.id ? 'step' : undefined} disabled={busy || editing} mix={on('click', () => { void change(routes.dashboard.cards.update.href(params()), { columnId: column.id }) })}>{column.name}</button>)}</nav>}
              </div>
              <footer class="perma-meta">
                <span class="perma-avatar" aria-hidden="true">{initials(detail?.author ?? user.name)}</span>
                <div class="perma-meta-grid"><span>{detail ? 'Added' : 'Drafted'} <strong>{detail ? age(detail.created_at) : 'today'}</strong></span><span><RefreshIcon />Updated <strong>{detail ? age(detail.updated_at) : 'today'}</strong></span><span>By <strong>{detail?.author ?? user.name}</strong></span><span>{assigned ? <>Assigned to <strong>{user.name}</strong></> : 'Not assigned'}</span></div>
                <button class="perma-circle perma-assign" type="button" id="card-assign-trigger" popoverTarget="card-assign" disabled={busy} aria-label="Assign someone" aria-haspopup="dialog" aria-expanded="false"><AssignIcon /></button>
                <CardPicker id="card-assign" title="Assign this to…" shortcut="A" label="Filter people" busy={busy} options={[{ value: user.id, label: 'Me', search: user.name, selected: !!assigned, shortcut: 'M' }]} onSelect={() => { void assign() }} />
                {detail && <button class="perma-circle perma-reaction" type="button" disabled title="Reactions are not available yet" aria-label="Add a reaction (not available yet)">🚀</button>}
              </footer>
            </article>
          </div>
          {detail && <aside class="perma-tools perma-tools-right" aria-label="Card actions">
            <button class="perma-circle" type="button" disabled title="Comment notifications are not available yet" aria-label="Watch card (not available yet)"><BellIcon /></button>
            <button class="perma-circle pin-button" type="button" aria-label={detail?.pinned ? 'Unpin card' : 'Pin card'} aria-pressed={!!detail?.pinned} disabled={!detail || busy} mix={on('click', () => { void change(routes.dashboard.cards.update.href(params()), { pinned: !detail!.pinned }) })}><PinIcon /></button>
          </aside>}
          <div class="perma-actions">
            {editing ? <><button type="submit" form="card-edit-form" class="perma-primary" disabled={busy || !editorReady || editorUploading}>{busy ? 'Saving…' : detail ? 'Save changes' : 'Create card'}</button><button class="perma-secondary" type="button" disabled={busy || (!detail && (!editorReady || editorUploading))} mix={on('click', () => { if (detail) cancel(); else void save(true) })}>{detail ? 'Cancel' : 'Create and add another'}</button></> : <><button class="perma-primary" type="button" disabled={busy} mix={on('click', edit)}>Edit <kbd>E</kbd></button><button class="perma-primary complete-button" type="button" disabled={busy || board.columns.length < 2} mix={on('click', toggleDone)}>{done ? 'Reopen' : 'Mark as Done'}<kbd>D</kbd></button></>}
          </div>
          {error && <p class="perma-error" role="alert">{error}</p>}
        </section>
        {detail && <section class="perma-discussion" aria-label="Comments">
          {detail.files.some(file => file.id !== detail!.cover_file_id) && <div class="perma-files">{detail.files.filter(file => file.id !== detail!.cover_file_id).map(file => <a href={routes.dashboard.boards.file.href({ boardId: board!.id, fileId: file.id })} key={file.id} download><PaperclipIcon />{file.name}</a>)}</div>}
          {[...detail.comments].reverse().map(entry => <article class="perma-comment" key={entry.id}><span class="perma-avatar" aria-hidden="true">{initials(entry.author)}</span><div class="perma-comment-content"><div class="perma-comment-meta"><strong>{entry.author}</strong><time dateTime={new Date(entry.created_at).toISOString()}>{age(entry.created_at)}</time></div>{entry.body_html ? <div class="lexxy-content" innerHTML={unsafeHTML(entry.body_html)} /> : <p class="plain-description">{entry.body}</p>}</div></article>)}
          <div class="perma-comment perma-comment-new"><span class="perma-avatar" aria-hidden="true">{initials(user.name)}</span><form class="perma-comment-compose" mix={[ref(node => { commentForm = node }), on('submit', async event => {
            event.preventDefault(); if (commentBlank || busy || commentUploading) return
            if (await change(routes.dashboard.cards.addComment.href(params()), { bodyHtml: comment })) { comment = ''; commentBlank = true; commentVersion++; handle.update() }
          })]}><RichEditor key={commentVersion} value="" label="Comment" onUploading={blocked => { commentUploading = blocked; handle.update() }} placeholder="Next, add some notes, context, pictures, or video about this…" onChange={(html, blank) => { comment = html; commentBlank = blank; handle.update() }} /><button class="perma-primary perma-post" type="submit" disabled={commentBlank || busy || commentUploading}>{busy ? 'Posting…' : 'Post'}</button></form></div>
          <div class="perma-subscribers"><h2>Subscribers</h2><p>Comment notifications are not enabled.</p></div>
        </section>}
      </>}
    </>
  }
})
