import type { Handle } from 'remix/component'
import type { Issue } from 'remix/data-schema'

import { routes } from '../../routes.ts'
import { authSwitchStyle, CardLayout, Field, formStyle } from '../../ui/layout.tsx'
import type { Theme } from '../../ui/theme.ts'

export interface SignupValues {
  name: string
  email: string
}

interface SignupPageProps {
  theme?: Theme
  values?: SignupValues
  issues?: readonly Issue[]
}

export function SignupPage(handle: Handle<SignupPageProps>) {
  return () => {
    let { theme, values, issues = [] } = handle.props
    let issueFor = (name: string) => issues.find((issue) => issue.path?.[0] === name)?.message
    let nameIssue = issueFor('name')
    let emailIssue = issueFor('email')
    let passwordIssue = issueFor('password')

    return (
      <CardLayout theme={theme} title="Create an account">
        {issues.length > 0 && (
          <p role="alert" class="alert">
            Please correct the fields below.
          </p>
        )}
        <form
          method="post"
          action={routes.signup.action.href()}
          mix={formStyle}
        >
          <Field id="signup-name" label="Name" issue={nameIssue}>
            <input
              class="field"
              id="signup-name"
              name="name"
              type="text"
              autoComplete="name"
              defaultValue={values?.name}
              required
              aria-invalid={nameIssue ? 'true' : undefined}
              aria-describedby={nameIssue ? 'signup-name-error' : undefined}
            />
          </Field>
          <Field id="signup-email" label="Email" issue={emailIssue}>
            <input
              class="field"
              id="signup-email"
              name="email"
              type="email"
              autoComplete="email"
              defaultValue={values?.email}
              required
              aria-invalid={emailIssue ? 'true' : undefined}
              aria-describedby={emailIssue ? 'signup-email-error' : undefined}
            />
          </Field>
          <Field id="signup-password" label="Password" issue={passwordIssue}>
            {/* Never echo a submitted password back into the page. */}
            <input
              class="field"
              id="signup-password"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              aria-invalid={passwordIssue ? 'true' : undefined}
              aria-describedby={passwordIssue ? 'signup-password-error' : undefined}
            />
          </Field>
          <button type="submit" class="btn btn-primary">
            Sign up
          </button>
        </form>
        <p mix={authSwitchStyle}>
          Already have an account? <a href={routes.login.index.href()}>Log in</a>
        </p>
      </CardLayout>
    )
  }
}
