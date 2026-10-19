import { routes } from '../../../../routes.ts'
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

declare global {
  namespace JSX {
    interface IntrinsicElements {
      'lexxy-editor': IntrinsicElements['div'] & { placeholder: string }
    }
  }
}

export function plainHtml(text: string) {
  return text ? '<p>' + text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>') + '</p>' : ''
}

export function RichEditor(handle: Handle<{
  value: string; label: string; placeholder: string; onChange: (html: string, blank: boolean) => void
  onReady?: (editor: RichEditorElement) => void
  onUploading?: (blocked: boolean) => void
}>) {
  let initialValue = handle.props.value
  let editor: RichEditorElement | undefined
  let failed = false, uploading = 0
  let failures: { id: number; file: File; message: string; retry: boolean }[] = [], sequence = 0
  let staged = new Set<string>(), requests = new Set<XMLHttpRequest>()
  function changed() { handle.props.onUploading?.(uploading > 0 || failures.length > 0); handle.update() }
  function cleanup() {
    for (let request of requests) request.abort()
    for (let id of staged) void fetch(routes.dashboard.uploads.discard.href({ fileId: id }), { method: 'POST', keepalive: true }).catch(() => {})
    staged.clear()
  }
  function fail(file: File, message: string, retry: boolean) { failures.push({ id: ++sequence, file, message, retry }); changed() }
  function send(file: File, pending: PendingAttachment): Promise<UploadResult> {
    return new Promise((resolve, reject) => {
      let xhr = new XMLHttpRequest(); requests.add(xhr)
      xhr.open('POST', routes.dashboard.uploads.create.href()); xhr.setRequestHeader('Accept', 'application/json'); xhr.responseType = 'json'; xhr.timeout = 120000
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
  function connect(node: HTMLElement) {
    editor = node as RichEditorElement
    // Listen before Lexxy's initialization event, including when its runtime is already loaded.
    editor.addEventListener('lexxy:file-accept', event => {
      event.preventDefault()
      accept((event as CustomEvent<{ file: File }>).detail.file)
    }, { signal: handle.signal })
    editor.addEventListener('lexxy:initialize', () => handle.props.onReady?.(editor!), { signal: handle.signal })
    editor.addEventListener('lexxy:change', () => handle.props.onChange(editor!.value, editor!.isBlank), { signal: handle.signal })
    // Lexxy owns its value. A JSX value prop makes Remix restore it on native input events.
    if (customElements.get('lexxy-editor')) editor.value = initialValue
    else editor.setAttribute('value', initialValue)
  }
  handle.queueTask(async () => {
    handle.signal.addEventListener('abort', cleanup, { once: true })
    window.addEventListener('pagehide', cleanup, { signal: handle.signal })
    try {
      // Upgrade the server-rendered editor in place; its CSS reserves space before JS loads.
      // @ts-expect-error Generated browser ESM; built by scripts/build-editor.mjs.
      await import('../../../public/lexxy/runtime/lexxy.js')
    } catch { if (!handle.signal.aborted) { failed = true; handle.update() } }
  })
  return () => <div class="rich-editor-wrap">
    <lexxy-editor class="lexxy-content" data-rmx-preserve-dom
      aria-label={handle.props.label} data-initial-value={initialValue} placeholder={handle.props.placeholder}
      data-blob-url-template={routes.dashboard.uploads.file.href({ fileId: ':signed_id' }).replace('%3Asigned_id', ':signed_id')}
      mix={ref(connect)} />
    {uploading > 0 && <p class="editor-upload-status" role="status">Uploading {uploading === 1 ? 'attachment' : `${uploading} attachments`}…</p>}
    {failures.map(item => <div class="editor-upload-error" key={item.id} role="alert"><p><strong>{item.file.name}</strong>: {item.message}</p>
      {item.retry && <button type="button" mix={on('click', () => { failures = failures.filter(f => f.id !== item.id); accept(item.file); changed() })}>Retry upload</button>}
      <button type="button" mix={on('click', () => { failures = failures.filter(f => f.id !== item.id); changed() })}>Remove failed attachment</button>
    </div>)}
    {failed && <p role="alert">The editor couldn’t load. Reload this page to try again.</p>}
  </div>
}
