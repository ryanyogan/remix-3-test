import { clientEntry, css, on } from 'remix/component'
import type { Handle } from 'remix/component'

import { routes } from '../../../../routes.ts'

interface BoardTileProps {
  id: string
  name: string
  color: string
  cardCount: number
}

// Deleting hides the tile right away and restores it if the server refuses.
export const BoardTile = clientEntry(
  import.meta.url,
  function BoardTile(handle: Handle<BoardTileProps>) {
    let deleting = false

    return () => {
      let { id, name, color, cardCount } = handle.props
      if (deleting) return null

      return (
        <li mix={tileStyle} style={{ borderBottomColor: color }}>
          <a href={routes.dashboard.boards.show.href({ boardId: id })} mix={linkStyle}>
            <span mix={css({ fontWeight: 700 })}>{name}</span>
            <span mix={css({ color: 'var(--text-tertiary)', fontSize: '12px' })}>
              {cardCount} {cardCount === 1 ? 'card' : 'cards'}
            </span>
          </a>
          <form
            method="post"
            action={routes.dashboard.boards.destroy.href({ boardId: id })}
            mix={on('submit', async (event, signal) => {
              event.preventDefault()
              deleting = true
              handle.update()
              try {
                let response = await fetch(event.currentTarget.action, {
                  method: 'POST',
                  headers: { Accept: 'application/json' },
                  signal,
                })
                if (!response.ok) throw new Error(`Delete failed with status ${response.status}`)
              } catch (error) {
                if (signal.aborted) return
                console.error(error)
                deleting = false
                handle.update()
                return
              }
              await handle.frame.reload()
            })}
          >
            <button type="submit" aria-label={`Delete board "${name}"`} mix={deleteStyle}>
              ✕
            </button>
          </form>
        </li>
      )
    }
  },
)

const tileStyle = css({
  position: 'relative',
  borderRadius: '12px',
  borderBottom: '6px solid',
  background: 'var(--surface-3)',
  transition: 'box-shadow 150ms ease',
  '&:hover': { boxShadow: '0 6px 18px rgb(0 0 0 / 0.12)' },
  '& form': { margin: 0 },
})

const linkStyle = css({
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'space-between',
  height: '120px',
  padding: '16px',
  color: 'inherit',
  textDecoration: 'none',
  overflowWrap: 'anywhere',
  '&:focus-visible': { outline: '2px solid var(--brand-blue)', borderRadius: '12px' },
})

const deleteStyle = css({
  position: 'absolute',
  top: '10px',
  right: '10px',
  width: '28px',
  height: '28px',
  border: 0,
  borderRadius: '8px',
  font: 'inherit',
  background: 'transparent',
  color: 'var(--text-tertiary)',
  cursor: 'pointer',
  '&:hover, &:focus-visible': { color: 'var(--danger)', background: 'var(--surface-4)' },
})
