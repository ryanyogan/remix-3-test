import { sql, type Database } from 'remix/data-table'
import type { FileStorage } from 'remix/file-storage'
import { limits } from './limits.ts'

export interface EditorFile { id: string; name: string; type: string; size: number; staged: boolean }
export const uploadLifetime = 24 * 60 * 60 * 1000
export const previewTypes = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

// Only recognized raster bytes may render inline; SVG/HTML and all other files download.
export async function safeFileType(file: File) {
  let b = new Uint8Array(await file.slice(0, 12).arrayBuffer())
  if ([137,80,78,71,13,10,26,10].every((v,i) => b[i] === v)) return 'image/png'
  if (b[0] === 255 && b[1] === 216 && b[2] === 255) return 'image/jpeg'
  let text = String.fromCharCode(...b)
  if (/^GIF8[79]a/.test(text)) return 'image/gif'
  if (text.startsWith('RIFF') && text.slice(8,12) === 'WEBP') return 'image/webp'
  return 'application/octet-stream'
}

export async function findEditorFile(db: Database, userId: string, id: string): Promise<EditorFile | null> {
  let result = await db.exec(sql`select f.id, f.name, f.type, f.size, 0 as staged from board_item_files f join boards b on b.id = f.board_id
    where f.id = ${id} and b.user_id = ${userId}
    union all select id, name, type, size, 1 as staged from editor_uploads where id = ${id} and user_id = ${userId} and created_at > ${Date.now() - uploadLifetime}`)
  let row = result.rows?.[0]
  return row ? { id: String(row.id), name: String(row.name), type: String(row.type), size: Number(row.size), staged: !!row.staged } : null
}

export async function prepareEditorFiles(db: Database, userId: string, cardId: string, ids: string[]): Promise<EditorFile[]> {
  if (!ids.length) return []
  let files: EditorFile[] = []
  for (let id of ids) {
    let file = await findEditorFile(db, userId, id)
    if (!file) throw new Error('An attachment is missing or expired. Remove it and upload it again.')
    if (!file.staged) {
      let linked = await db.exec(sql`select id from board_item_files where id = ${id} and item_id = ${cardId}`)
      if (!linked.rows?.length) throw new Error('Attachments must belong to this card.')
    }
    files.push(file)
  }
  let count = await db.exec(sql`select count(*) as count from board_item_files where item_id = ${cardId}`)
  if (Number(count.rows?.[0].count ?? 0) + files.filter(f => f.staged).length > limits.filesPerCard) throw new Error(`Use up to ${limits.filesPerCard} files per card.`)
  return files
}

// Call within the card/comment write transaction. Unique ids prevent two cards from
// claiming the same staged upload, including in D1's atomic write batch.
export async function claimEditorFiles(tx: Database, userId: string, boardId: string, cardId: string, files: EditorFile[]) {
  for (let file of files.filter(f => f.staged)) {
    await tx.exec(sql`insert into board_item_files(id, board_id, item_id, name, type, size, created_at)
      values (${file.id}, ${boardId}, ${cardId}, ${file.name}, ${file.type}, ${file.size}, ${Date.now()})`)
    await tx.exec(sql`delete from editor_uploads where id = ${file.id} and user_id = ${userId}`)
  }
}

// Abandoned uploads are private and expire. Reclaim their R2 objects on the next
// upload by the owner; explicit discard removes them immediately.
export async function pruneEditorUploads(db: Database, storage: FileStorage, userId: string) {
  let expired = await db.exec(sql`select id from editor_uploads where user_id = ${userId} and created_at <= ${Date.now() - uploadLifetime} limit 50`)
  for (let row of expired.rows ?? []) {
    await storage.remove(String(row.id))
    await db.exec(sql`delete from editor_uploads where id = ${row.id} and user_id = ${userId}`)
  }
}
