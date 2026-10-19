import { on, ref, type Handle } from 'remix/component'
import { limits } from '../../../../data/limits.ts'

interface UploadResult { id: string; signed_id: string; attachable_sgid: string; filename: string; byte_size: number; content_type: string; previewable: boolean; url: string }
interface PendingAttachment { setAttributes(value: UploadResult): void; setUploadProgress(progress: number): void; remove(): void }
export interface RichEditorElement extends HTMLElement {
  value: string
  isBlank: boolean
  focus(): void
  contents: { insertPendingAttachment(file: File): PendingAttachment | null }
}

export function plainHtml(text: string) {
  return text ? '<p>' + text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>') + '</p>' : ''
}

export function RichEditor(handle: Handle<{
  value: string; label: string; placeholder: string; onChange: (html: string, blank: boolean) => void
  onReady?: (editor: RichEditorElement) => void
  onUploading?: (blocked: boolean) => void
}>) {
  let mount: HTMLDivElement | undefined, editor: RichEditorElement | undefined
  let failed = false, uploading = 0
  let failures: { id: number; file: File; message: string; retry: boolean }[] = [], sequence = 0
  let staged = new Set<string>(), requests = new Set<XMLHttpRequest>()
  function changed() { handle.props.onUploading?.(uploading > 0 || failures.length > 0); handle.update() }
  function cleanup() {
    for (let request of requests) request.abort()
    for (let id of staged) void fetch(`/api/v1/uploads/${id}`, { method: 'DELETE', keepalive: true }).catch(() => {})
    staged.clear()
  }
  function fail(file: File, message: string, retry: boolean) { failures.push({ id: ++sequence, file, message, retry }); changed() }
  function send(file: File, pending: PendingAttachment): Promise<UploadResult> {
    return new Promise((resolve, reject) => {
      let xhr = new XMLHttpRequest(); requests.add(xhr)
      xhr.open('POST', '/api/v1/uploads'); xhr.responseType = 'json'; xhr.timeout = 120000
      xhr.upload.onprogress = event => { if (event.lengthComputable) pending.setUploadProgress(Math.max(1, Math.round(event.loaded / event.total * 95))) }
      xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve(xhr.response.data) : reject(new Error(xhr.response?.error ?? 'Upload failed. Try again.'))
      xhr.onerror = () => reject(new Error('Upload failed. Check your connection and try again.'))
      xhr.ontimeout = () => reject(new Error('The upload timed out. Try again.'))
      xhr.onabort = () => reject(new Error('Upload cancelled.'))
      xhr.onloadend = () => requests.delete(xhr)
      let body = new FormData(); body.set('file', file); xhr.send(body)
    })
  }
  function accept(file: File) {
    if (!editor) return
    if (!file.size || file.size > limits.fileBytes) { fail(file, `Choose a nonempty file of at most ${limits.fileLabel}.`, false); return }
    let count = new DOMParser().parseFromString(editor.value, 'text/html').querySelectorAll('action-text-attachment').length
    if (count + uploading >= limits.filesPerCard) { fail(file, `Use up to ${limits.filesPerCard} files per card.`, false); return }
    uploading++; changed()
    // File-accept can fire inside Lexical's clipboard transaction. Insert the
    // pending attachment after that transaction, keeping its selected position.
    queueMicrotask(async () => {
      if (handle.signal.aborted || !editor) return
      let pending = editor.contents.insertPendingAttachment(file)
      if (!pending) { uploading--; fail(file, 'Could not add this attachment. Try again.', true); return }
      pending.setUploadProgress(1)
      try {
        let result = await send(file, pending)
        staged.add(result.id)
        if (handle.signal.aborted) { cleanup(); return }
        pending.setAttributes(result)
      } catch (error) {
        if (!handle.signal.aborted) { pending.remove(); fail(file, error instanceof Error ? error.message : 'Upload failed.', true) }
      } finally { uploading--; if (!handle.signal.aborted) changed() }
    })
  }
  handle.queueTask(async () => {
    try {
      // @ts-expect-error Generated browser ESM; built by scripts/build-editor.mjs.
      await import('../../../public/lexxy/runtime/lexxy.js')
      await customElements.whenDefined('lexxy-editor')
      if (handle.signal.aborted || !mount) return
      editor = document.createElement('lexxy-editor') as RichEditorElement
      editor.classList.add('lexxy-content')
      editor.setAttribute('aria-label', handle.props.label)
      editor.setAttribute('value', handle.props.value)
      editor.setAttribute('placeholder', handle.props.placeholder)
      editor.dataset.blobUrlTemplate = '/api/v1/files/:signed_id'
      // Use Lexxy's pending-attachment interface rather than Rails Active Storage.
      // This event covers toolbar selection, dropped files, and clipboard images.
      editor.addEventListener('lexxy:file-accept', event => {
        event.preventDefault()
        accept((event as CustomEvent<{ file: File }>).detail.file)
      }, { signal: handle.signal })
      editor.addEventListener('lexxy:initialize', () => handle.props.onReady?.(editor!), { signal: handle.signal })
      editor.addEventListener('lexxy:change', () => handle.props.onChange(editor!.value, editor!.isBlank), { signal: handle.signal })
      handle.signal.addEventListener('abort', cleanup, { once: true })
      window.addEventListener('pagehide', cleanup, { signal: handle.signal })
      mount.replaceChildren(editor)
    } catch { failed = true; handle.update() }
  })
  return () => <div class="rich-editor-wrap">
    <div class="rich-editor-mount" data-rmx-preserve-dom mix={ref(node => { mount = node })} />
    {uploading > 0 && <p class="editor-upload-status" role="status">Uploading {uploading === 1 ? 'attachment' : `${uploading} attachments`}…</p>}
    {failures.map(item => <div class="editor-upload-error" key={item.id} role="alert"><p><strong>{item.file.name}</strong>: {item.message}</p>
      {item.retry && <button type="button" mix={on('click', () => { failures = failures.filter(f => f.id !== item.id); accept(item.file); changed() })}>Retry upload</button>}
      <button type="button" mix={on('click', () => { failures = failures.filter(f => f.id !== item.id); changed() })}>Remove failed attachment</button>
    </div>)}
    {failed && <p role="alert">The editor couldn’t load. Reload this page to try again.</p>}
  </div>
}
