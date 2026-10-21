import * as s from 'remix/data-schema'
import * as f from 'remix/data-schema/form-data'

import { limits } from '../../../data/limits.ts'

const name = s
  .string()
  .transform((value) => value.trim())
  .refine((value) => value.length > 0, 'Enter a name')
  .refine((value) => value.length <= limits.name, `Keep names to ${limits.name} characters`)

export const newBoardForm = f.object({
  name: f.field(name),
})
