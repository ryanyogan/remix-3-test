import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'

import { BoardStore, applyMutations, dropPosition, formatBytes, type BoardData } from './board-model.ts'

const board: BoardData = {
  id: 'b',
  name: 'Board',
  color: '#cbd5e1',
  columns: [
    { id: 'todo', name: 'To do', position: 1 },
    { id: 'done', name: 'Done', position: 2 },
  ],
  items: [
    { id: 'a', columnId: 'todo', title: 'A', position: 1, files: [] },
    {
      id: 'b',
      columnId: 'todo',
      title: 'B',
      position: 2,
      files: [{ id: 'f1', name: 'spec.pdf', type: 'application/pdf', size: 2048 }],
    },
  ],
}

describe('applyMutations', () => {
  it('renders server data unchanged with no pending mutations', () => {
    let view = applyMutations(board, [])
    assert.equal(view.name, 'Board')
    assert.deepEqual(
      view.columns.map((column) => column.items.map((item) => item.id)),
      [['a', 'b'], []],
    )
  })

  it('layers pending creates, moves, deletes, and renames over server data', () => {
    let view = applyMutations(board, [
      { type: 'renameBoard', name: 'Renamed' },
      { type: 'upsertItem', id: 'b', columnId: 'todo', title: 'B', position: 0.5 },
      { type: 'upsertItem', id: 'c', columnId: 'done', title: 'C', position: 1 },
      { type: 'deleteItem', id: 'a' },
      { type: 'upsertColumn', id: 'new', name: 'Later' },
      { type: 'upsertColumn', id: 'done', name: 'Shipped' },
    ])

    assert.equal(view.name, 'Renamed')
    assert.deepEqual(
      view.columns.map((column) => [column.name, column.items.map((item) => item.id)]),
      [
        ['To do', ['b']],
        ['Later', []],
        ['Shipped', ['c']],
      ],
    )
  })

  it('returns cards from a deleted column to the remaining intake, preserving files', () => {
    let view = applyMutations(board, [
      { type: 'upsertItem', id: 'c', columnId: 'todo', title: 'C', position: 3 },
      { type: 'deleteColumn', id: 'todo' },
    ])
    assert.deepEqual(
      view.columns.map((column) => [column.id, column.items.map((item) => item.id)]),
      [['done', ['a', 'b', 'c']]],
    )
  })
})

describe('file mutations', () => {
  it('keeps attachments when a card moves', () => {
    let view = applyMutations(board, [
      { type: 'upsertItem', id: 'b', columnId: 'done', title: 'B', position: 1 },
    ])
    assert.deepEqual(
      view.columns[1].items[0].files.map((file) => file.name),
      ['spec.pdf'],
    )
  })

  it('shows an upload as pending and hides a deleted file', () => {
    let file = new File(['hello'], 'notes.txt', { type: 'text/plain' })
    let view = applyMutations(board, [
      { type: 'uploadFile', id: 'f2', itemId: 'b', file },
      { type: 'deleteFile', id: 'f1', itemId: 'b' },
    ])
    assert.deepEqual(view.columns[0].items[1].files, [
      { id: 'f2', name: 'notes.txt', type: 'text/plain', size: 5, pending: true },
    ])
  })
})

describe('formatBytes', () => {
  it('rounds to a readable unit', () => {
    assert.equal(formatBytes(512), '512 B')
    assert.equal(formatBytes(2048), '2 KB')
    assert.equal(formatBytes(2.5 * 1024 * 1024), '2.5 MB')
  })
})

describe('dropPosition', () => {
  let items = board.items

  it('lands between neighbours', () => {
    assert.equal(dropPosition(items, 0, 'top'), 0.5)
    assert.equal(dropPosition(items, 0, 'bottom'), 1.5)
    assert.equal(dropPosition(items, 1, 'top'), 1.5)
    assert.equal(dropPosition(items, 1, 'bottom'), 2.5)
  })
})


describe('optimistic write ordering', () => {
  it('keeps rapid changes visible while serializing writes to the same card', async () => {
    let original = globalThis.fetch
    let requests: Array<{ body: Record<string, unknown>; resolve(response: Response): void }> = []
    globalThis.fetch = async (_input, init) => new Promise<Response>(resolve => {
      requests.push({ body: JSON.parse(String(init?.body)), resolve })
    })
    try {
      let store = new BoardStore('board', async () => {})
      let create = store.submit({ type: 'upsertItem', id: 'card', columnId: 'todo', title: 'First title', position: 1 })
      let move = store.submit({ type: 'upsertItem', id: 'card', columnId: 'done', title: 'Latest title', position: 2 })
      assert.equal(requests.length, 1)
      assert.equal(store.mutations.length, 1)
      assert.equal(store.mutations[0].type, 'upsertItem')
      assert.equal((store.mutations[0] as { title: string }).title, 'Latest title')
      // A second card is independent and must not wait behind this one.
      let other = store.submit({ type: 'upsertItem', id: 'other', columnId: 'todo', title: 'Independent', position: 3 })
      assert.equal(requests.length, 2)
      requests[1].resolve(new Response(null, { status: 201 }))
      await other
      requests[0].resolve(new Response(null, { status: 201 }))
      await create
      assert.equal(requests.length, 3)
      assert.equal(requests[2].body.columnId, 'done')
      requests[2].resolve(new Response(null, { status: 201 }))
      await move
      await store.whenItemSettled('card')
      store.reloaded()
      assert.equal(store.mutations.length, 0)
    } finally { globalThis.fetch = original }
  })
})

describe('failed card saves', () => {
  it('rejects waiting on a card whose save failed, and does not upload to it', async () => {
    let original = globalThis.fetch
    let urls: string[] = []
    globalThis.fetch = async (input) => {
      urls.push(String(input))
      return Response.json({ error: 'Nope' }, { status: 500 })
    }
    try {
      let store = new BoardStore('board', async () => {})
      let create = store.submit({ type: 'upsertItem', id: 'card', columnId: 'todo', title: 'Draft', position: 1 })
      let opened = store.whenItemSettled('card')
      let upload = store.submit({ type: 'uploadFile', id: 'f1', itemId: 'card', file: new File(['x'], 'x.txt') })
      await create
      await assert.rejects(opened)
      await upload
      assert.equal(urls.length, 1)
      assert.equal(store.error, "The card wasn't saved, so the file wasn't attached.")
      assert.equal(store.mutations.length, 0)
      // Nothing is pending once it failed, so a later open is not blocked.
      await store.whenItemSettled('card')
    } finally { globalThis.fetch = original }
  })
})
