import { routes } from '../../../../routes.ts'
import { TypedEventTarget } from 'remix/component'


import type { BoardData, ColumnData, FileData, ItemData } from '@trellix/contracts'
export type { BoardData, ColumnData, FileData, ItemData } from '@trellix/contracts'

export type Mutation =
  | { type: 'renameBoard'; name: string }
  | { type: 'upsertColumn'; id: string; name: string; color?: import('@trellix/contracts').ColumnColor }
  | { type: 'deleteColumn'; id: string }
  | { type: 'moveColumn'; id: string; direction: 'left' | 'right' }
  | { type: 'upsertItem'; id: string; columnId: string; title: string; position: number }
  | { type: 'deleteItem'; id: string }
  | { type: 'uploadFile'; id: string; itemId: string; file: File }
  | { type: 'deleteFile'; id: string; itemId: string }

export interface BoardView {
  name: string
  columns: Array<ColumnData & { items: ItemData[] }>
}

// The drag payload type, so drops from other pages or apps are ignored.
export const CARD_MIME_TYPE = 'application/x-trellix-card'

// Mutations of the same record share a key: only the newest optimistic state is shown,
// while writes are sent in order so the final position cannot be overwritten by an older one.
export function mutationKey(mutation: Mutation): string {
  switch (mutation.type) {
    case 'renameBoard':
      return 'board'
    case 'upsertColumn':
    case 'deleteColumn':
    case 'moveColumn':
      return `column:${mutation.id}`
    case 'upsertItem':
    case 'deleteItem':
      return `item:${mutation.id}`
    case 'uploadFile':
    case 'deleteFile':
      return `file:${mutation.id}`
  }
}

// What the user should see: the server's board with every pending mutation applied on top.
export function applyMutations(board: BoardData, mutations: Iterable<Mutation>): BoardView {
  let name = board.name
  let columns = new Map(board.columns.map((column) => [column.id, { ...column }]))
  let items = new Map(board.items.map((item) => [item.id, item]))

  for (let mutation of mutations) {
    switch (mutation.type) {
      case 'renameBoard':
        name = mutation.name
        break
      case 'upsertColumn': {
        let existing = columns.get(mutation.id)
        let tail = [...columns.values()].sort((a, b) => b.position - a.position)
        let position = existing?.position ?? (mutation.name.toLowerCase() === 'not now' ? 0
          : tail.length >= 2 ? (tail[0].position + tail[1].position) / 2 : (tail[0]?.position ?? 0) + 1)
        columns.set(mutation.id, { id: mutation.id, name: mutation.name, color: mutation.color ?? existing?.color ?? 'blue', position })
        break
      }
      case 'deleteColumn': {
        let intake = [...columns.values()].sort((a, b) => a.position - b.position).find(column => column.id !== mutation.id && column.name.toLowerCase() !== 'not now')
        if (!intake) break
        let position = Math.max(0, ...[...items.values()].filter(item => item.columnId === intake.id).map(item => item.position))
        for (let item of [...items.values()].sort((a, b) => a.position - b.position)) if (item.columnId === mutation.id) items.set(item.id, { ...item, columnId: intake.id, position: ++position })
        columns.delete(mutation.id)
        break
      }
      case 'moveColumn': {
        let work = [...columns.values()].filter(column => column.name.toLowerCase() !== 'not now').sort((a, b) => a.position - b.position).slice(1, -1)
        let index = work.findIndex(column => column.id === mutation.id)
        let neighbor = work[index + (mutation.direction === 'left' ? -1 : 1)]
        if (index >= 0 && neighbor) [work[index].position, neighbor.position] = [neighbor.position, work[index].position]
        break
      }
      case 'upsertItem':
        items.set(mutation.id, {
          ...items.get(mutation.id),
          id: mutation.id,
          columnId: mutation.columnId,
          title: mutation.title,
          position: mutation.position,
          files: items.get(mutation.id)?.files ?? [],
        })
        break
      case 'deleteItem':
        items.delete(mutation.id)
        break
      case 'uploadFile': {
        let item = items.get(mutation.itemId)
        if (!item || item.files.some((file) => file.id === mutation.id)) break
        let { name, type, size } = mutation.file
        let file = { id: mutation.id, name, type, size, pending: true }
        items.set(item.id, { ...item, files: [...item.files, file] })
        break
      }
      case 'deleteFile': {
        let item = items.get(mutation.itemId)
        if (!item) break
        items.set(item.id, { ...item, files: item.files.filter((file) => file.id !== mutation.id) })
        break
      }
    }
  }

  let view = [...columns.values()]
    .sort((a, b) => a.position - b.position)
    .map((column) => ({ ...column, items: [] as ItemData[] }))
  let byId = new Map(view.map((column) => [column.id, column]))
  for (let item of items.values()) byId.get(item.columnId)?.items.push(item)
  for (let column of view) column.items.sort((a, b) => a.position - b.position)

  return { name, columns: view }
}

// Positions are floats: a card dropped between 1 and 2 gets 1.5, so a move never renumbers
// its neighbours. Dropping on the top half of a card lands before it, the bottom half after.
export function dropPosition(items: ItemData[], index: number, edge: 'top' | 'bottom'): number {
  let target = items[index].position
  if (edge === 'top') return ((items[index - 1]?.position ?? 0) + target) / 2
  return ((items[index + 1]?.position ?? target + 1) + target) / 2
}

export function appendPosition(items: ItemData[]): number {
  return items.length === 0 ? 1 : items[items.length - 1].position + 1
}

export function mutationRequest(boardId: string, mutation: Mutation): { href: string; init: RequestInit } {
  function json(href: string, body?: unknown) {
    return { href, init: { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) } }
  }
  let board = routes.dashboard.boards, card = routes.dashboard.cards
  switch (mutation.type) {
    case 'renameBoard': return json(board.rename.href({ boardId }), { name: mutation.name })
    case 'upsertColumn': return json(board.upsertColumn.href({ boardId }), { id: mutation.id, name: mutation.name, color: mutation.color })
    case 'moveColumn': return json(board.moveColumn.href({ boardId, columnId: mutation.id }), { direction: mutation.direction })
    case 'deleteColumn': return json(board.deleteColumn.href({ boardId, columnId: mutation.id }))
    case 'upsertItem': return json(board.upsertItem.href({ boardId }), { id: mutation.id, title: mutation.title, columnId: mutation.columnId, position: mutation.position })
    case 'deleteItem': return json(board.deleteItem.href({ boardId, itemId: mutation.id }))
    case 'deleteFile': return json(board.deleteFile.href({ boardId, fileId: mutation.id }))
    case 'uploadFile': {
      let body = new FormData(); body.set('id', mutation.id); body.set('file', mutation.file)
      return { href: card.uploadFile.href({ boardId, cardId: mutation.itemId }), init: { method: 'POST', body, headers: { Accept: 'application/json' } } }
    }
  }
}

// A file's size for display, e.g. "2.4 MB".
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

interface PendingMutation {
  mutation: Mutation
  controller: AbortController
  // The server accepted it; it stays applied until a reload brings back data that has it.
  settled: boolean
  // Resolves once the request finishes, whether it succeeded, failed, or was replaced.
  done: Promise<void>
}

// Owns the in-flight mutations for one board, like Remix 2's fetchers did for Trellix. Each
// mutation renders immediately; once the server accepts it the page reloads, and the
// mutation is dropped only when that reload has landed, so nothing flickers back.
export class BoardStore extends TypedEventTarget<{ change: Event }> {
  error: string | null = null
  #pending = new Map<string, PendingMutation>()
  #boardId: string
  #reload: () => Promise<unknown>

  constructor(boardId: string, reload: () => Promise<unknown>) {
    super()
    this.#boardId = boardId
    this.#reload = reload
  }

  get mutations(): Mutation[] {
    return [...this.#pending.values()].map((pending) => pending.mutation)
  }

  async submit(mutation: Mutation): Promise<void> {
    let key = mutationKey(mutation)
    let previous = this.#pending.get(key)

    let finished = Promise.withResolvers<void>()
    let entry: PendingMutation = {
      mutation,
      controller: new AbortController(),
      settled: false,
      done: finished.promise,
    }
    this.#pending.set(key, entry)
    this.error = null
    this.#emit()

    try {
      // Aborting fetch does not cancel a server write. Serialize changes to the same
      // resource so a fast move/delete cannot overtake its still-running creation.
      // The newest optimistic state is already visible; unrelated cards stay concurrent.
      if (previous) await previous.done
      // A file can be attached to a card whose create is still in flight; the upload waits
      // for the card to exist on the server.
      if (mutation.type === 'uploadFile') {
        await this.whenItemSettled(mutation.itemId).catch(() => {
          throw new MutationError("The card wasn't saved, so the file wasn't attached.")
        })
      }
      if (entry.controller.signal.aborted) return

      let { href, init } = mutationRequest(this.#boardId, mutation)
      let response = await fetch(href, {
        ...init,
        signal: entry.controller.signal,
      })
      if (!response.ok) throw new MutationError(await readError(response))
    } catch (error) {
      if (entry.controller.signal.aborted) return
      console.error('Board mutation failed', error)
      if (this.#pending.get(key) === entry) this.#pending.delete(key)
      this.error =
        error instanceof MutationError
          ? error.message
          : "Couldn't save that change. The board has been refreshed."
      this.#emit()
      void this.#reload()
      return
    } finally {
      finished.resolve()
    }

    if (this.#pending.get(key) !== entry) return
    entry.settled = true
    // Each reload supersedes the previous one, and only the last to start reports completion,
    // so every settled mutation is covered by the reload that eventually completes.
    void this.#reload()
  }

  // Shows a problem caught before any request was sent, such as a file that is too large.
  reject(message: string): void {
    this.error = message
    this.#emit()
  }

  // Resolves once the card's latest change is saved, or at once when nothing is pending.
  // Rejects when that change failed: the card may not exist on the server, and the failure is
  // already shown. Once the board refreshes nothing is pending, so a retry goes through.
  async whenItemSettled(itemId: string) {
    let pending = this.#pending.get(`item:${itemId}`)
    while (pending && !pending.settled) {
      await pending.done
      let next = this.#pending.get(`item:${itemId}`)
      if (next === pending) break
      if (!next && !pending.settled) throw new MutationError("That card wasn't saved.")
      pending = next
    }
  }

  // Call when a page reload completes: settled mutations are now part of the server data.
  reloaded(): void {
    let changed = false
    for (let [key, pending] of this.#pending) {
      if (!pending.settled) continue
      this.#pending.delete(key)
      changed = true
    }
    if (changed) this.#emit()
  }

  dismissError(): void {
    this.error = null
    this.#emit()
  }

  #emit() {
    this.dispatchEvent(new Event('change'))
  }
}

// A request the server refused with a message meant for the user (validation, limits).
class MutationError extends Error {}

async function readError(response: Response): Promise<string> {
  if (response.status >= 400 && response.status < 500) {
    try {
      let body = await response.json()
      if (typeof body?.error === 'string') return body.error
    } catch {}
  }
  return `Couldn't save that change (${response.status}). The board has been refreshed.`
}
