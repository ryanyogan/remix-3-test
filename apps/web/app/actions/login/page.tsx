import type { Handle } from 'remix/component'
import type { Issue } from 'remix/data-schema'

import { routes } from '../../routes.ts'
import { authSwitchStyle, CardLayout, Field, formStyle } from '../../ui/layout.tsx'
import type { Theme } from '../../ui/theme.ts'

interface LoginPageProps {
  theme?: Theme
  email?: string
  issues?: readonly Issue[]
  // A credentials failure, reported without saying which half was wrong.
  error?: string
}

export function LoginPage(handle: Handle<LoginPageProps>) {
  return () => {
    let { theme, email, issues = [], error } = handle.props
    let issueFor = (name: string) => issues.find((issue) => issue.path?.[0] === name)?.message
    let emailIssue = issueFor('email')
    let passwordIssue = issueFor('password')

    return (
      <CardLayout theme={theme} title="Log in">
        {(error || issues.length > 0) && (
          <p role="alert" class="alert">
            {error ?? 'Please correct the fields below.'}
          </p>
        )}
        <form
          method="post"
          action={routes.login.action.href()}
          mix={formStyle}
        >
          <Field id="login-email" label="Email" issue={emailIssue}>
            <input
              class="field"
              id="login-email"
              name="email"
              type="email"
              autoComplete="email"
              defaultValue={email}
              required
              aria-invalid={emailIssue || error ? 'true' : undefined}
              aria-describedby={emailIssue ? 'login-email-error' : undefined}
            />
          </Field>
          <Field id="login-password" label="Password" issue={passwordIssue}>
            <input
              class="field"
              id="login-password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              aria-invalid={passwordIssue || error ? 'true' : undefined}
              aria-describedby={passwordIssue ? 'login-password-error' : undefined}
            />
          </Field>
          <button type="submit" class="btn btn-primary">
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
