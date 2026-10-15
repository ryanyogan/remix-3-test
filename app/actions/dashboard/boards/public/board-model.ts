import { TypedEventTarget } from 'remix/component'

import { routes } from '../../../../routes.ts'

export interface ColumnData {
  id: string
  name: string
  position: number
}

export interface ItemData {
  id: string
  columnId: string
  title: string
  position: number
}

export interface BoardData {
  id: string
  name: string
  color: string
  columns: ColumnData[]
  items: ItemData[]
}

export type Mutation =
  | { type: 'renameBoard'; name: string }
  | { type: 'upsertColumn'; id: string; name: string }
  | { type: 'upsertItem'; id: string; columnId: string; title: string; position: number }
  | { type: 'deleteItem'; id: string }

export interface BoardView {
  name: string
  columns: Array<ColumnData & { items: ItemData[] }>
}

// The drag payload type, so drops from other pages or apps are ignored.
export const CARD_MIME_TYPE = 'application/x-trellix-card'

// Mutations of the same record share a key, so a newer one replaces (and cancels) an older
// one still in flight: dragging a card twice quickly only sends the final position.
export function mutationKey(mutation: Mutation): string {
  switch (mutation.type) {
    case 'renameBoard':
      return 'board'
    case 'upsertColumn':
      return `column:${mutation.id}`
    case 'upsertItem':
    case 'deleteItem':
      return `item:${mutation.id}`
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
        let position =
          existing?.position ?? Math.max(0, ...[...columns.values()].map((c) => c.position)) + 1
        columns.set(mutation.id, { id: mutation.id, name: mutation.name, position })
        break
      }
      case 'upsertItem':
        items.set(mutation.id, {
          id: mutation.id,
          columnId: mutation.columnId,
          title: mutation.title,
          position: mutation.position,
        })
        break
      case 'deleteItem':
        items.delete(mutation.id)
        break
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

export function mutationRequest(
  boardId: string,
  mutation: Mutation,
): { href: string; body: FormData } {
  let body = new FormData()
  let boards = routes.dashboard.boards

  switch (mutation.type) {
    case 'renameBoard':
      body.set('name', mutation.name)
      return { href: boards.rename.href({ boardId }), body }
    case 'upsertColumn':
      body.set('id', mutation.id)
      body.set('name', mutation.name)
      return { href: boards.upsertColumn.href({ boardId }), body }
    case 'upsertItem':
      body.set('id', mutation.id)
      body.set('columnId', mutation.columnId)
      body.set('title', mutation.title)
      body.set('position', String(mutation.position))
      return { href: boards.upsertItem.href({ boardId }), body }
    case 'deleteItem':
      return { href: boards.deleteItem.href({ boardId, itemId: mutation.id }), body }
  }
}

interface PendingMutation {
  mutation: Mutation
  controller: AbortController
  // The server accepted it; it stays applied until a reload brings back data that has it.
  settled: boolean
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
    this.#pending.get(key)?.controller.abort()

    let entry: PendingMutation = { mutation, controller: new AbortController(), settled: false }
    this.#pending.set(key, entry)
    this.error = null
    this.#emit()

    let { href, body } = mutationRequest(this.#boardId, mutation)
    try {
      let response = await fetch(href, {
        method: 'POST',
        body,
        headers: { Accept: 'application/json' },
        signal: entry.controller.signal,
      })
      if (!response.ok) throw new Error(`Request failed with status ${response.status}`)
    } catch (error) {
      if (entry.controller.signal.aborted) return
      console.error('Board mutation failed', error)
      if (this.#pending.get(key) === entry) this.#pending.delete(key)
      this.error = "Couldn't save that change. The board has been refreshed."
      this.#emit()
      void this.#reload()
      return
    }

    if (this.#pending.get(key) !== entry) return
    entry.settled = true
    // Each reload supersedes the previous one, and only the last to start reports completion,
    // so every settled mutation is covered by the reload that eventually completes.
    void this.#reload()
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
