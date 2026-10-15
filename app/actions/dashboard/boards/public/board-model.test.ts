import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'

import { applyMutations, dropPosition, formatBytes, type BoardData } from './board-model.ts'

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
        ['Shipped', ['c']],
        ['Later', []],
      ],
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
