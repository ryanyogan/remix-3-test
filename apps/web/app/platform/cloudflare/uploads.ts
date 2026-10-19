// Worker replacement for app/data/uploads.ts: card attachments live in the R2 binding.
import { env } from 'cloudflare:workers'

import { createR2FileStorage } from './r2-file-storage.ts'

export const uploads = createR2FileStorage(env.UPLOADS)
