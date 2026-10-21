import type { Handle } from 'remix/component'
import type { NavigationData } from '@trellix/contracts'
import { PlusIcon } from '../../../ui/public/icons.tsx'
import { routes } from '../../../routes.ts'

export function NewCardButton(_handle: Handle<{ boards: NavigationData['boards'] }>) {
  return () => <a href={routes.dashboard.cards.new.href()} class="home-action new-card-trigger" aria-keyshortcuts="c"><PlusIcon />Add a card <kbd>C</kbd></a>
}
