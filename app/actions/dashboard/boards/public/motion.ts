import { animateEntrance, animateExit, animateLayout, spring } from '@remix-run/ui/animation'

// Motion for the board, kept subtle: short springs, small offsets, mostly opacity. With
// reduced motion requested, entrances and exits become quick fades and layout snaps.
const reducedMotion =
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

// Entrances start only after the board's first client render, so hydrating a page full of
// cards stays still and only cards that arrive later animate in.
let entrancesEnabled = false

export function enableEntrances() {
  entrancesEnabled = true
}

const quickFade = { opacity: 0, duration: 120, easing: 'ease-out' }

type Offset = { transform?: string }

export function enter(from: Offset = { transform: 'translateY(6px) scale(0.98)' }) {
  if (!entrancesEnabled) return animateEntrance(false)
  return animateEntrance(reducedMotion ? quickFade : { opacity: 0, ...from, ...spring('snappy') })
}

export function exit(to: Offset = { transform: 'scale(0.96)' }) {
  return animateExit(
    reducedMotion ? quickFade : { opacity: 0, ...to, duration: 160, easing: 'ease-in' },
  )
}

// Slides an element to its new place when the list around it changes (reorders, deletes).
// Position only: scaling a card's text mid-move looks smeared.
export function glide() {
  return animateLayout(reducedMotion ? false : { ...spring('snappy'), size: false })
}
