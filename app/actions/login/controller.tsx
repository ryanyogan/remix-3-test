import { completeAuth } from 'remix/auth'
import * as s from 'remix/data-schema'
import { redirect } from 'remix/response/redirect'
import { createController } from 'remix/router'

import { hashPassword, verifyPassword } from '../../data/passwords.ts'
import { users } from '../../data/tables.ts'
import { routes } from '../../routes.ts'
import { LoginPage } from './page.tsx'
import { loginForm } from './schema.ts'

// Verified against when the email is unknown, so both failures take the same time.
const unknownUserHash = hashPassword('not-a-real-password')

export default createController(routes.login, {
  actions: {
    index(context) {
      if (context.auth.ok) return redirect(routes.dashboard.index.href(), 303)

      return context.render(<LoginPage />)
    },
    async action(context) {
      let submittedEmail = context.formData.get('email')
      let email = typeof submittedEmail === 'string' ? submittedEmail : ''

      let parsed = s.parseSafe(loginForm, context.formData)
      if (!parsed.success) {
        return context.render(<LoginPage email={email} issues={parsed.issues} />, { status: 400 })
      }

      let user = await context.db.findOne(users, { where: { email: parsed.value.email } })
      let valid = await verifyPassword(
        parsed.value.password,
        user?.password_hash ?? (await unknownUserHash),
      )
      if (user === null || !valid) {
        return context.render(<LoginPage email={email} error="Incorrect email or password" />, {
          status: 401,
        })
      }

      let session = completeAuth(context)
      session.set('auth', { userId: user.id })

      return redirect(routes.dashboard.index.href(), 303)
    },
  },
})
