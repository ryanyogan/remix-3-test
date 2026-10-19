import { animateExit, animateLayout } from '@remix-run/ui/animation'

// JS motion for the board and tiles, timed from the theme's motion tokens. With reduced motion
// requested, exits become an instant fade and layout changes snap, matching the theme's CSS.
const reducedMotion =
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

function token(name: string) {
  if (typeof document === 'undefined') return ''
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

function duration(name: string) {
  return Number.parseFloat(token(name)) || 0
}

// Plays as the element is removed. Pass `active: false` for removals that are not a delete,
// such as a card leaving one column for another.
export function leave(active: boolean, to: { transform: string }, ms = 220) {
  if (!active) return animateExit(false)
  if (reducedMotion) return animateExit({ opacity: 0, duration: 1 })
  return animateExit({ opacity: 0, ...to, duration: ms, easing: token('--ease-out') || 'ease-out' })
}

// Slides an element to its new place when the list around it changes (reorders, deletes).
// Position only: scaling a card's text mid-move looks smeared.
export function glide() {
  if (reducedMotion) return animateLayout(false)
  return animateLayout({
    duration: duration('--d-med'),
    easing: token('--ease-out') || 'ease-out',
    size: false,
  })
}
