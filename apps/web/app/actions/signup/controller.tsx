import type { SessionAuth } from '@trellix/session'
import { completeAuth } from 'remix/auth'
import * as s from 'remix/data-schema'
import { redirect } from 'remix/response/redirect'
import { createController } from 'remix/router'

import { hashPassword } from '../../data/passwords.ts'
import { users } from '../../data/tables.ts'
import { routes } from '../../routes.ts'
import { readTheme } from '../../ui/theme.ts'
import { SignupPage, type SignupValues } from './page.tsx'
import { signupForm } from './schema.ts'

export default createController(routes.signup, {
  actions: {
    async index(context) {
      if (context.auth.ok) return redirect(routes.dashboard.index.href(), 303)

      return context.render(<SignupPage theme={await readTheme(context.request)} />)
    },
    async action(context) {
      let theme = await readTheme(context.request)
      let values: SignupValues = {
        name: readText(context.formData, 'name'),
        email: readText(context.formData, 'email'),
      }

      let parsed = s.parseSafe(signupForm, context.formData)
      if (!parsed.success) {
        return context.render(
          <SignupPage theme={theme} values={values} issues={parsed.issues} />,
          { status: 400 },
        )
      }

      let { name, email, password } = parsed.value
      let id = crypto.randomUUID()

      let taken = () => {
        let issues = [{ message: 'An account with this email already exists', path: ['email'] }]
        return context.render(<SignupPage theme={theme} values={values} issues={issues} />, {
          status: 409,
        })
      }
      if ((await context.db.findOne(users, { where: { email } })) !== null) return taken()

      try {
        await context.db.create(users, {
          id,
          name,
          email,
          password_hash: await hashPassword(password),
          created_at: Date.now(),
        })
      } catch (error) {
        // The unique index on users.email rejects a concurrent duplicate that passed the check
        // above; answer it the same way rather than with a 500.
        if ((await context.db.findOne(users, { where: { email } })) !== null) return taken()
        throw error
      }

      let session = completeAuth(context)
      session.set('auth', { userId: id, version: 0 } satisfies SessionAuth)

      return redirect(routes.dashboard.index.href(), 303)
    },
  },
})

function readText(formData: FormData, name: string): string {
  let value = formData.get(name)
  return typeof value === 'string' ? value : ''
}
