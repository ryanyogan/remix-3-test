import * as s from 'remix/data-schema'
import * as coerce from 'remix/data-schema/coerce'
import * as f from 'remix/data-schema/form-data'

import { limits } from '../../../data/limits.ts'

const name = s
  .string()
  .transform((value) => value.trim())
  .refine((value) => value.length > 0, 'Enter a name')
  .refine((value) => value.length <= limits.name, `Keep names to ${limits.name} characters`)

// The browser generates ids for optimistic creates; without JavaScript the server does.
const clientId = s.optional(s.string().refine((value) => /^[\w-]{1,64}$/.test(value), 'Invalid id'))

export const newBoardForm = f.object({
  name: f.field(name),
})

export const renameBoardForm = f.object({ name: f.field(name) })

export const upsertColumnForm = f.object({
  id: f.field(clientId),
  name: f.field(name),
})

export const upsertItemForm = f.object({
  id: f.field(clientId),
  columnId: f.field(s.string()),
  title: f.field(
    s
      .string()
      .transform((value) => value.trim())
      .refine((value) => value.length > 0, 'Enter a card title')
      .refine(
        (value) => value.length <= limits.cardTitle,
        `Keep card titles to ${limits.cardTitle} characters`,
      ),
  ),
  position: f.field(
    s.optional(coerce.number().refine((value) => Number.isFinite(value), 'Invalid position')),
  ),
})

export const uploadFileForm = f.object({
  id: f.field(clientId),
  file: f.file(
    s
      .instanceof_(File)
      .refine((file) => file.size > 0, 'Choose a file that is not empty')
      .refine(
        (file) => file.size <= limits.fileBytes,
        `Files must be ${limits.fileLabel} or smaller`,
      ),
  ),
})
