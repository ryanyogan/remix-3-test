import * as s from 'remix/data-schema'
import * as checks from 'remix/data-schema/checks'
import * as f from 'remix/data-schema/form-data'

export const signupForm = f.object({
  name: f.field(
    s
      .string()
      .transform((value) => value.trim())
      .pipe(checks.minLength(1), checks.maxLength(100)),
  ),
  email: f.field(
    s
      .string()
      .transform((value) => value.trim().toLowerCase())
      .pipe(checks.email(), checks.maxLength(254)),
  ),
  // Passwords are not trimmed; whitespace is a legitimate character.
  password: f.field(s.string().pipe(checks.minLength(8), checks.maxLength(128))),
})
