import { columnColors, type ColumnColor } from '@trellix/contracts'
import { rawSql, sql, type Database } from 'remix/data-table'
import { loadCard } from './cards.ts'
import {
  claimEditorFiles,
  findEditorFile,
  prepareEditorFiles,
  previewTypes,
  pruneEditorUploads,
  safeFileType,
  type EditorFile,
} from './editor-uploads.ts'
import { richText, attachmentIds } from './rich-text.ts'
import { movementKind, recordActivity } from './activity.ts'
import { limits } from './limits.ts'
import { boards, boardItems, boardItemFiles } from './tables.ts'
import {
  attachFile,
  createBoard,
  deleteColumn,
  moveColumn,
  removeStoredFiles,
  upsertColumn,
  upsertItem,
} from './boards.ts'
import {
  booleanField,
  numberField,
  textField,
  tokenHash,
  OperationError,
} from './operation-errors.ts'
import type { Services, BoardServices, CardServices, StoredDownload } from './operation-context.ts'

export async function stageEditorUpload(services: Services, form: FormData) {
  let file = form.get('file')
  if (
    !(file instanceof File) ||
    !file.size ||
    file.size > limits.fileBytes ||
    form.getAll('file').length !== 1
  )
    throw new OperationError(422, {
      message: `Choose one nonempty file of at most ${limits.fileLabel}`,
    })
  let userId = services.user.id
  await pruneEditorUploads(services.db, services.uploads, userId)
  let id = crypto.randomUUID(),
    name = file.name.trim().slice(0, limits.fileName) || 'file'
  let type = await safeFileType(file)
  try {
    await services.uploads.set(id, new File([file], name, { type }))
    let result = await services.db
      .exec(sql`insert into editor_uploads(id, user_id, name, type, size, created_at)
        select ${id}, ${userId}, ${name}, ${type}, ${file.size}, ${Date.now()}
        where (select count(*) from editor_uploads where user_id = ${userId}) < 50 returning id`)
    if (!result.rows?.length)
      throw new OperationError(422, {
        message: 'Finish or discard your pending uploads before adding more.',
      })
  } catch (error) {
    await services.uploads.remove(id)
    throw error
  }
  return {
    id,
    signed_id: id,
    attachable_sgid: id,
    filename: name,
    byte_size: file.size,
    content_type: type,
    previewable: previewTypes.has(type),
  }
}

export async function readEditorFile(
  services: Services,
  params: { fileId: string },
): Promise<StoredDownload> {
  let file = await findEditorFile(services.db, services.user.id, params.fileId)
  let stored = file && (await services.uploads.get(file.id))
  if (!file || !stored) throw new OperationError(404, { message: 'File not found' })
  return {
    file: stored,
    name: file.name,
    disposition: previewTypes.has(file.type) ? 'inline' : 'attachment',
    sandbox: true,
  }
}

export async function discardEditorUpload(services: Services, params: { fileId: string }) {
  let result = await services.db.exec(
    sql`select id from editor_uploads where id = ${params.fileId} and user_id = ${services.user.id}`,
  )
  if (result.rows?.length) {
    await services.uploads.remove(params.fileId)
    await services.db.exec(
      sql`delete from editor_uploads where id = ${params.fileId} and user_id = ${services.user.id}`,
    )
  }
  return undefined
}

export async function createUserBoard(services: Services, input: Record<string, unknown>) {
  let name = textField(input.name, 'Name', 100)
  let id = await createBoard(services.db, services.user.id, { name })
  return { id, name }
}

export async function searchCards(services: Services, query: URLSearchParams) {
  let q = textField(query.get('q') ?? '', 'Search', 200, true)
  let limit = Math.floor(Math.min(100, Math.max(1, Number(query.get('limit') ?? 50) || 50)))
  let after = query.get('after') ?? ''
  let separator = after.indexOf(':')
  let afterTime = after ? Number(after.slice(0, separator)) : Number.MAX_SAFE_INTEGER
  let afterId = after ? after.slice(separator + 1) : ''
  if (after && (separator < 1 || !Number.isFinite(afterTime) || !afterId))
    throw new OperationError(422, { message: 'Invalid search cursor' })
  let pattern = `%${q.replace(/[!%_]/g, '!$&')}%`
  let result = await services.db.exec(sql`
      select i.id, i.title, i.board_id, i.column_id, i.created_at, b.name as board_name,
        b.color, co.name as column_name, coalesce(d.tags, '[]') as tags,
        coalesce(d.pinned, 0) as pinned, coalesce(d.priority, 'normal') as priority
      from boards b join board_items i on i.board_id = b.id
      join board_columns co on co.id = i.column_id
      left join card_details d on d.item_id = i.id
      where b.user_id = ${services.user.id} and (${after} = '' or i.created_at < ${afterTime} or (i.created_at = ${afterTime} and i.id < ${afterId}))
        and (${q} = '' or i.title like ${pattern} escape '!' or d.description like ${pattern} escape '!' or d.tags like ${pattern} escape '!')
        and (${query.get('pinned') ?? ''} != 'true' or d.pinned = 1)
        and (${query.get('boardId') ?? ''} = '' or b.id = ${query.get('boardId') ?? ''})
      order by i.created_at desc, i.id desc limit ${Math.floor(limit) + 1}
    `)
  let rows = result.rows ?? []
  let more = rows.length > limit
  let data = rows.slice(0, limit).map((row) => ({ ...row, tags: JSON.parse(String(row.tags)) }))
  return {
    data,
    next: more ? `${rows[limit - 1].created_at}:${rows[limit - 1].id}` : null,
  }
}

export async function watchBoard(services: BoardServices, input: Record<string, unknown>) {
  let watching = booleanField(input.watching, 'Watching')
  await services.db.exec(sql`insert into board_watches(board_id, watching, since)
      values (${services.board.id}, ${watching ? 1 : 0}, ${Date.now()})
      on conflict(board_id) do update set watching = excluded.watching, since = excluded.since`)
  return undefined
}

export async function renameBoard(services: BoardServices, input: Record<string, unknown>) {
  await services.db.update(boards, services.board.id, {
    name: textField(input.name, 'Name', 100),
  })
  return undefined
}

export async function removeBoard(services: BoardServices) {
  await removeStoredFiles(services.db, services.uploads, {
    board_id: services.board.id,
  })
  await services.db.delete(boards, services.board.id)
  return undefined
}

export async function createBoardColumn(services: BoardServices, input: Record<string, unknown>) {
  let id = clientId(input.id)
  if (
    !(await upsertColumn(services.db, services.board.id, {
      id,
      name: textField(input.name, 'Name', 100),
      color: columnColor(input.color),
    }))
  )
    throw new OperationError(404, { message: 'Column not found' })
  return { id }
}

export async function updateBoardColumn(
  services: BoardServices,
  params: { columnId: string },
  input: Record<string, unknown>,
) {
  if (
    !(await upsertColumn(services.db, services.board.id, {
      id: params.columnId,
      name: textField(input.name, 'Name', 100),
      color: columnColor(input.color),
    }))
  )
    throw new OperationError(404)
  return undefined
}

export async function reorderBoardColumn(
  services: BoardServices,
  params: { columnId: string },
  input: Record<string, unknown>,
) {
  if (input.direction !== 'left' && input.direction !== 'right')
    throw new OperationError(422, { message: 'Choose left or right' })
  if (!(await moveColumn(services.db, services.board.id, params.columnId, input.direction)))
    throw new OperationError(422, { message: 'Column cannot move in that direction' })
  return undefined
}

export async function removeBoardColumn(services: BoardServices, params: { columnId: string }) {
  await deleteColumn(services.db, services.uploads, services.board.id, params.columnId)
  return undefined
}

export async function createBoardCard(services: BoardServices, input: Record<string, unknown>) {
  let id = clientId(input.id)
  let prepared =
    input.descriptionHtml === undefined
      ? undefined
      : await editorContent(
          services.db,
          services.user.id,
          id,
          textField(input.descriptionHtml, 'Description', 60000, true),
        )
  let description = prepared?.content
  if (description && description.text.length > 20000)
    throw new OperationError(422, { message: 'Keep descriptions to 20000 characters' })
  let tags = input.tags === undefined ? undefined : cardTags(input.tags)
  let assigneeId =
    input.assigneeId === undefined ? undefined : cardAssignee(input.assigneeId, services.user.id)
  if (input.steps !== undefined && (!Array.isArray(input.steps) || input.steps.length > 200))
    throw new OperationError(422, { message: 'Use up to 200 steps' })
  let steps = (input.steps as Record<string, unknown>[] | undefined)?.map((step) => {
    if (!step || typeof step !== 'object')
      throw new OperationError(422, { message: 'Invalid step' })
    return {
      title: textField(step.title, 'Step', 300),
      completed: step.completed === undefined ? false : !!booleanField(step.completed, 'Completed'),
    }
  })
  if (
    !(await upsertItem(services.db, services.board.id, {
      id,
      columnId: textField(input.columnId, 'Column', 64),
      title: textField(input.title, 'Title', limits.cardTitle),
      description,
      tags,
      assigneeId,
      steps,
      uploads: prepared ? { userId: services.user.id, files: prepared.files } : undefined,
      position:
        input.position === undefined
          ? undefined
          : numberField(input.position, 'Position', -Number.MAX_VALUE),
    }))
  )
    throw new OperationError(404, { message: 'Column not found' })
  return { id }
}

export async function updateBoardCard(
  services: CardServices,
  params: { cardId: string },
  input: Record<string, unknown>,
) {
  let id = params.cardId
  let item = services.card
  let title =
    input.title === undefined ? item.title : textField(input.title, 'Title', limits.cardTitle)
  let boardId = input.boardId === undefined ? item.board_id : textField(input.boardId, 'Board', 64)
  if (boardId !== item.board_id) {
    let owned = await services.db.findOne(boards, {
      where: { id: boardId, user_id: services.user.id },
    })
    if (!owned) throw new OperationError(404, { message: 'Board not found' })
  }
  let firstColumn =
    boardId !== item.board_id
      ? await services.db.exec(
          sql`select id from board_columns where board_id = ${boardId} order by position, id limit 1`,
        )
      : null
  let columnId =
    input.columnId === undefined
      ? String(firstColumn?.rows?.[0]?.id ?? item.column_id)
      : textField(input.columnId, 'Column', 64)
  let position =
    input.position === undefined
      ? columnId === item.column_id
        ? Number(item.position)
        : undefined
      : numberField(input.position, 'Position', -Number.MAX_VALUE)
  let files: EditorFile[] = []
  let fields: Record<string, unknown> = {}
  if (input.descriptionHtml !== undefined) {
    let prepared = await editorContent(
      services.db,
      services.user.id,
      id,
      textField(input.descriptionHtml, 'Description', 60000, true),
    )
    let content = prepared.content
    files = prepared.files
    if (content.text.length > 20000)
      throw new OperationError(422, { message: 'Keep descriptions to 20000 characters' })
    fields.description = content.text
    fields.description_html = content.html
  } else if (input.description !== undefined) {
    fields.description = textField(input.description, 'Description', 20000, true)
    fields.description_html = ''
  }
  if (input.tags !== undefined) fields.tags = JSON.stringify(cardTags(input.tags))
  if (input.assigneeId !== undefined)
    fields.assignee_id = cardAssignee(input.assigneeId, services.user.id)
  if (input.pinned !== undefined) fields.pinned = booleanField(input.pinned, 'Pinned')
  if (input.priority !== undefined) {
    if (!['normal', 'high', 'urgent'].includes(String(input.priority)))
      throw new OperationError(422, { message: 'Invalid priority' })
    fields.priority = input.priority
  }
  if (input.snoozedUntil !== undefined)
    fields.snoozed_until = numberField(input.snoozedUntil, 'Snooze date')
  // Validate the destination before starting a D1 batch; reads never rely on queued writes.
  let destination = await services.db.exec(
    sql`select id, name from board_columns where id = ${columnId} and board_id = ${boardId}`,
  )
  if (!destination.rows?.length) throw new OperationError(404, { message: 'Column not found' })
  if (position === undefined) {
    let result = await services.db.exec(
      sql`select coalesce(max(position), 0) + 1 as position from board_items where column_id = ${columnId}`,
    )
    position = Number(result.rows![0].position)
  }
  let moved = columnId !== item.column_id
  let kind = moved ? await movementKind(services.db, boardId, columnId) : ('updated' as const)
  // db.update() implicitly requests RETURNING; D1 batches require a non-returning query.
  await services.db.transaction(async (tx) => {
    await claimEditorFiles(tx, services.user.id, boardId, id, files)
    await tx
      .query(boardItems)
      .where({ id })
      .update({ title, board_id: boardId, column_id: columnId, position })
    if (boardId !== item.board_id)
      await tx.query(boardItemFiles).where({ item_id: id }).update({ board_id: boardId })
    await tx.exec(sql`insert into card_details(item_id, updated_at) values (${id}, ${Date.now()})
        on conflict(item_id) do update set updated_at = excluded.updated_at`)
    if (Object.keys(fields).length) {
      await tx.exec(
        rawSql(
          `update card_details set ${Object.keys(fields)
            .map((key) => `${key} = ?`)
            .join(', ')} where item_id = ?`,
          [...Object.values(fields), id],
        ),
      )
    }
    if (moved || title !== item.title || Object.keys(fields).length) {
      await recordActivity(tx, id, kind, moved ? String(destination.rows![0].name) : '')
    }
  })
  return undefined
}

export async function removeBoardCard(services: CardServices, params: { cardId: string }) {
  await removeStoredFiles(services.db, services.uploads, {
    item_id: params.cardId,
  })
  await services.db.delete(boardItems, params.cardId)
  return undefined
}

export async function setCardCover(services: CardServices, form: FormData) {
  let file = form.get('file')
  if (
    !(file instanceof File) ||
    !file.size ||
    file.size > limits.fileBytes ||
    form.getAll('file').length !== 1
  )
    throw new OperationError(422, { message: `Choose one image of at most ${limits.fileLabel}` })
  let bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer())
  let valid =
    (file.type === 'image/png' &&
      [137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b)) ||
    (file.type === 'image/jpeg' && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) ||
    (file.type === 'image/webp' &&
      String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
      String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP')
  if (!valid) throw new OperationError(422, { message: 'Choose a PNG, JPEG, or WebP image' })
  let card = await loadCard(services.db, services.board.id, services.card.id)
  let id = crypto.randomUUID()
  let result = await attachFile(services.db, services.uploads, services.board.id, services.card.id, {
    id,
    file,
  })
  if (result === 'missing') throw new OperationError(404, { message: 'Card not found' })
  if (result === 'full')
    throw new OperationError(422, {
      message: `A card can hold up to ${limits.filesPerCard} files`,
    })
  await services.db
    .exec(sql`insert into card_details(item_id, cover_file_id, updated_at) values (${services.card.id}, ${id}, ${Date.now()})
      on conflict(item_id) do update set cover_file_id = excluded.cover_file_id, updated_at = excluded.updated_at`)
  if (card?.cover_file_id) {
    await services.uploads.remove(card.cover_file_id)
    await services.db.delete(boardItemFiles, card.cover_file_id)
  }
  return { id }
}

export async function readCardCover(services: CardServices): Promise<StoredDownload> {
  let card = await loadCard(services.db, services.board.id, services.card.id)
  let stored = card?.cover_file_id && (await services.uploads.get(card.cover_file_id))
  if (!stored) throw new OperationError(404, { message: 'Image not found' })
  return { file: stored, disposition: 'inline' }
}

export async function removeCardCover(services: CardServices) {
  let card = await loadCard(services.db, services.board.id, services.card.id)
  if (card?.cover_file_id) {
    await services.uploads.remove(card.cover_file_id)
    await services.db.delete(boardItemFiles, card.cover_file_id)
  }
  return undefined
}

export async function uploadCardFile(
  services: CardServices,
  params: { cardId: string },
  form: FormData,
) {
  let file = form.get('file')
  if (
    !(file instanceof File) ||
    file.size === 0 ||
    file.size > limits.fileBytes ||
    form.getAll('file').length !== 1
  )
    throw new OperationError(422, {
      message: `Choose one nonempty file of at most ${limits.fileLabel}`,
    })
  let id = clientId(form.get('id') ?? undefined)
  let result = await attachFile(services.db, services.uploads, services.board.id, params.cardId, {
    id,
    file,
  })
  if (result === 'missing') throw new OperationError(404, { message: 'Card not found' })
  if (result === 'full')
    throw new OperationError(422, {
      message: `A card can hold up to ${limits.filesPerCard} files`,
    })
  return { id, name: file.name, size: file.size }
}

export async function readBoardFile(
  services: BoardServices,
  params: { fileId: string },
): Promise<StoredDownload> {
  let row = await services.db.findOne(boardItemFiles, {
    where: { id: params.fileId, board_id: services.board.id },
  })
  let stored = row && (await services.uploads.get(row.id))
  if (!row || !stored) throw new OperationError(404, { message: 'File not found' })
  return { file: stored, name: row.name, disposition: 'attachment' }
}

export async function removeBoardFile(services: BoardServices, params: { fileId: string }) {
  let row = await services.db.findOne(boardItemFiles, {
    where: { id: params.fileId, board_id: services.board.id },
  })
  if (!row) throw new OperationError(404, { message: 'File not found' })
  await services.uploads.remove(row.id)
  await services.db.delete(boardItemFiles, row.id)
  return undefined
}

export async function createCardStep(
  services: CardServices,
  params: { cardId: string },
  input: Record<string, unknown>,
) {
  let id = crypto.randomUUID()
  let result = await services.db.exec(sql`insert into card_steps(id, item_id, title, created_at)
      select ${id}, ${params.cardId}, ${textField(input.title, 'Step', 300)}, ${Date.now()}
      where (select count(*) from card_steps where item_id = ${params.cardId}) < 200 returning id`)
  if (!result.rows?.length)
    throw new OperationError(422, {
      message: 'A card can have up to 200 steps',
    })
  return { id }
}

export async function updateCardStep(
  services: CardServices,
  params: { stepId: string; cardId: string },
  input: Record<string, unknown>,
) {
  await services.db
    .exec(sql`update card_steps set completed = ${booleanField(input.completed, 'Completed')}
      where id = ${params.stepId} and item_id = ${params.cardId}`)
  return undefined
}

export async function removeCardStep(
  services: CardServices,
  params: { stepId: string; cardId: string },
) {
  await services.db.exec(
    sql`delete from card_steps where id = ${params.stepId} and item_id = ${params.cardId}`,
  )
  return undefined
}

export async function createCardComment(
  services: CardServices,
  params: { cardId: string },
  input: Record<string, unknown>,
) {
  let prepared =
    input.bodyHtml === undefined
      ? null
      : await editorContent(
          services.db,
          services.user.id,
          params.cardId,
          textField(input.bodyHtml, 'Comment', 30000, true),
        )
  let content = prepared?.content
  let body = textField(content ? content.text : input.body, 'Comment', 10000)
  let id = crypto.randomUUID()
  await services.db.transaction(async (tx) => {
    await claimEditorFiles(
      tx,
      services.user.id,
      services.board.id,
      params.cardId,
      prepared?.files ?? [],
    )
    await tx.exec(sql`insert into card_comments(id, item_id, user_id, body, body_html, created_at)
        values (${id}, ${params.cardId}, ${services.user.id}, ${body}, ${content?.html ?? ''}, ${Date.now()})`)
  })
  return { id }
}

export async function removeCardComment(
  services: CardServices,
  params: { commentId: string; cardId: string },
) {
  await services.db.exec(
    sql`delete from card_comments where id = ${params.commentId} and item_id = ${params.cardId} and user_id = ${services.user.id}`,
  )
  return undefined
}

export async function listAccessTokens(services: Services) {
  let result = await services.db.exec(
    sql`select id, name, created_at from api_tokens where user_id = ${services.user.id} order by created_at desc`,
  )
  return result.rows
}

export async function createAccessToken(services: Services, input: Record<string, unknown>) {
  let name = textField(input.name, 'Token name', 80)
  let id = crypto.randomUUID()
  let token =
    'trx_' +
    Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join('')
  let hash = await tokenHash(token)
  let result = await services.db
    .exec(sql`insert into api_tokens(id, user_id, name, token_hash, created_at)
      select ${id}, ${services.user.id}, ${name}, ${hash}, ${Date.now()}
      where (select count(*) from api_tokens where user_id = ${services.user.id}) < 20 returning id`)
  if (!result.rows?.length)
    throw new OperationError(422, {
      message: 'Revoke an existing token before creating another (limit 20)',
    })
  return { id, name, token }
}

export async function revokeAccessToken(services: Services, params: { tokenId: string }) {
  await services.db.exec(
    sql`delete from api_tokens where id = ${params.tokenId} and user_id = ${services.user.id}`,
  )
  return undefined
}

function clientId(value: unknown): string {
  if (value === undefined) return crypto.randomUUID()
  if (
    typeof value !== 'string' ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)
  )
    throw new OperationError(422, { message: 'ID must be a UUID' })
  return value
}

function cardTags(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 12)
    throw new OperationError(422, { message: 'Use up to 12 tags' })
  return [...new Set(value.map((tag) => textField(tag, 'Tag', 30).toLowerCase()))]
}
function cardAssignee(value: unknown, owner: string): string | null {
  // Personal boards currently have one member. Never expose or assign unrelated accounts.
  if (value === null || value === owner) return value
  throw new OperationError(422, { message: 'Choose a member of this board' })
}

async function editorContent(db: Database, userId: string, cardId: string, html: string) {
  try {
    let ids = attachmentIds(html)
    if (ids.length > limits.filesPerCard)
      throw new Error(`Use up to ${limits.filesPerCard} files per card.`)
    let files = await prepareEditorFiles(db, userId, cardId, ids)
    return { content: richText(html, files), files }
  } catch (error) {
    if (error instanceof Error && /attachment|files per card/i.test(error.message))
      throw new OperationError(422, { message: error.message })
    throw error
  }
}

function columnColor(value: unknown): ColumnColor | undefined {
  if (value === undefined) return
  if (!columnColors.includes(value as ColumnColor))
    throw new OperationError(422, { message: 'Choose a column color' })
  return value as ColumnColor
}
