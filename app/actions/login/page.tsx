import type { Handle } from 'remix/component'
import { css } from 'remix/component'
import type { Issue } from 'remix/data-schema'

import { routes } from '../../routes.ts'
import { authSwitchStyle, buttonStyle, CardLayout, errorStyle, Field } from '../../ui/layout.tsx'

interface LoginPageProps {
  email?: string
  issues?: readonly Issue[]
  // A credentials failure, reported without saying which half was wrong.
  error?: string
}

export function LoginPage(handle: Handle<LoginPageProps>) {
  return () => {
    let { email, issues = [], error } = handle.props
    let issueFor = (name: string) => issues.find((issue) => issue.path?.[0] === name)?.message
    let emailIssue = issueFor('email')
    let passwordIssue = issueFor('password')

    return (
      <CardLayout title="Log in">
        {(error || issues.length > 0) && (
          <p role="alert" mix={errorStyle}>
            {error ?? 'Please correct the fields below.'}
          </p>
        )}
        <form
          method="post"
          action={routes.login.action.href()}
          mix={css({ display: 'flex', flexDirection: 'column', gap: '16px' })}
        >
          <Field id="login-email" label="Email" issue={emailIssue}>
            <input
              id="login-email"
              name="email"
              type="email"
              autoComplete="email"
              defaultValue={email}
              required
              aria-invalid={emailIssue || error ? true : undefined}
              aria-describedby={emailIssue ? 'login-email-error' : undefined}
            />
          </Field>
          <Field id="login-password" label="Password" issue={passwordIssue}>
            <input
              id="login-password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              aria-invalid={passwordIssue || error ? true : undefined}
              aria-describedby={passwordIssue ? 'login-password-error' : undefined}
            />
          </Field>
          <button type="submit" mix={buttonStyle}>
            Log in
          </button>
        </form>
        <p mix={authSwitchStyle}>
          New here? <a href={routes.signup.index.href()}>Create an account</a>
        </p>
      </CardLayout>
    )
  }
}
