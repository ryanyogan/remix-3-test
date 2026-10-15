import { fileURLToPath } from 'node:url'
import { createFsFileStorage } from 'remix/file-storage/fs'

// Card attachments, stored under server-generated keys (the board_item_files row id).
// Original file names are metadata only and never become paths.
export const uploads = createFsFileStorage(
  process.env.UPLOADS_DIR ?? fileURLToPath(new URL('../../uploads/', import.meta.url)),
)
