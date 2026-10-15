import * as s from 'remix/data-schema'
import * as checks from 'remix/data-schema/checks'
import * as coerce from 'remix/data-schema/coerce'
import * as f from 'remix/data-schema/form-data'

const name = s
  .string()
  .transform((value) => value.trim())
  .pipe(checks.minLength(1), checks.maxLength(100))

// The browser generates ids for optimistic creates; without JavaScript the server does.
const clientId = s.optional(s.string().refine((value) => /^[\w-]{1,64}$/.test(value), 'Invalid id'))

export const newBoardForm = f.object({
  name: f.field(name),
  // Board colors land in inline styles, so only accept a plain hex color.
  color: f.field(
    s
      .optional(s.string())
      .transform((value) => value ?? '#cbd5e1')
      .refine((value) => /^#[0-9a-f]{6}$/i.test(value), 'Choose a color'),
  ),
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
      .pipe(checks.minLength(1), checks.maxLength(500)),
  ),
  position: f.field(
    s.optional(coerce.number().refine((value) => Number.isFinite(value), 'Invalid position')),
  ),
})
