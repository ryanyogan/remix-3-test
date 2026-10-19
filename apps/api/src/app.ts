import * as operations from '@trellix/data/operations'
import { OperationError } from '@trellix/data/operation-errors'
import type { StoredDownload } from '@trellix/data/operation-context'
import type { Context } from 'hono'
import { loadCard } from '@trellix/data/cards'
import { loadWorkspace } from '@trellix/data/workspace'
import { loadNavigation } from '@trellix/data/activity'
import { listBoards, loadBoardData } from '@trellix/data/boards'
import { limits } from '@trellix/data/limits'
import type { User, Board, BoardItem } from '@trellix/data/tables'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { HTTPException } from 'hono/http-exception'
import { DataTableValidationError, sql, type Database } from 'remix/data-table'
import { createFileResponse } from 'remix/response/file'
import type { FileStorage } from 'remix/file-storage'
import { tokenHash } from './validation.ts'

type Env = {
  Bindings: {
    db: Database
    uploads: FileStorage
    sessionUserId: string | null
    browserOrigin?: string
  }
  Variables: { user: User; board: Board; card: BoardItem; tokenAuth: boolean }
}

export function createApi() {
  let api = new Hono<Env>().basePath('/api/v1')
  api.use('*', async (c, next) => {
    let start = performance.now()
    c.header('Cache-Control', 'private, no-store')
    c.header('X-Content-Type-Options', 'nosniff')
    await next()
    c.header('Server-Timing', `api;dur=${(performance.now() - start).toFixed(1)}`)
  })
  api.get('/health', (c) => c.json({ status: 'ok', version: 1 }))
  api.use('*', (c, next) =>
    bodyLimit({
      maxSize:
        c.req.method === 'POST' &&
        (c.req.path === '/api/v1/uploads' ||
          /^\/api\/v1\/boards\/[^/]+\/cards\/[^/]+\/(?:files|cover)$/.test(c.req.path))
          ? limits.fileBytes + 64 * 1024
          : 64 * 1024,
      onError: (c) => c.json({ error: 'Request is too large' }, 413),
    })(c, next),
  )
  api.use('*', async (c, next) => {
    let authorization = c.req.header('Authorization')
    let userId = c.env.sessionUserId
    let hash = ''
    c.set('tokenAuth', Boolean(authorization))
    if (authorization) {
      let token = /^Bearer (trx_[a-f0-9]{64})$/.exec(authorization)?.[1]
      if (!token) throw new HTTPException(401, { message: 'Invalid access token' })
      hash = await tokenHash(token)
    } else if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
      let origin = c.req.header('Origin')
      if (
        !origin ||
        origin !== (c.env.browserOrigin ?? new URL(c.req.url).origin) ||
        c.req.header('Sec-Fetch-Site') === 'cross-site'
      ) {
        throw new HTTPException(403, {
          message: 'A same-origin request or bearer token is required',
        })
      }
    }
    if (!hash && !userId)
      throw new HTTPException(401, {
        message: 'Sign in or supply a bearer token',
      })
    // Resolve identity and resource ownership in one indexed query. Keeping these checks
    // together avoids three serial D1 round trips before a card can even be read.
    let match = /^\/api\/v1\/boards\/([^/]+)(?:\/cards\/([^/]+))?/.exec(c.req.path)
    let boardId = match ? decodeURIComponent(match[1]) : ''
    let cardId = match?.[2] ? decodeURIComponent(match[2]) : ''
    let lookup = await c.env.db.exec(sql`
      select u.id, u.email, u.name, u.created_at,
        b.id as board_id, b.name as board_name, b.color, b.created_at as board_created_at,
        i.id as card_id, i.column_id, i.title, i.position, i.created_at as card_created_at
      from users u
      left join boards b on b.user_id = u.id and b.id = ${boardId}
      left join board_items i on i.board_id = b.id and i.id = ${cardId}
      where u.id = case when ${hash} != ''
        then (select user_id from api_tokens where token_hash = ${hash}) else ${userId} end
    `)
    let row = lookup.rows?.[0]
    if (!row)
      throw new HTTPException(401, {
        message: 'Sign in or supply a bearer token',
      })
    c.set('user', {
      id: String(row.id),
      email: String(row.email),
      name: String(row.name),
      created_at: Number(row.created_at),
    })
    if (boardId) {
      if (!row.board_id) throw new HTTPException(404, { message: 'Board not found' })
      c.set('board', {
        id: boardId,
        user_id: String(row.id),
        name: String(row.board_name),
        color: String(row.color),
        created_at: Number(row.board_created_at),
      })
    }
    if (cardId) {
      if (!row.card_id) throw new HTTPException(404, { message: 'Card not found' })
      c.set('card', {
        id: cardId,
        board_id: boardId,
        column_id: String(row.column_id),
        title: String(row.title),
        position: Number(row.position),
        created_at: Number(row.card_created_at),
      })
    }
    await next()
  })
  api.get('/workspace', async (c) =>
    c.json({ data: await loadWorkspace(c.env.db, c.get('user').id) }),
  )
  api.post('/uploads', async (c) => {
    let data = await operations.stageEditorUpload(services(c), await multipart(c.req.raw))
    return c.json({ data: { ...data, url: `/api/v1/files/${data.id}` } }, 201)
  })
  api.get('/files/:fileId', async (c) => {
    return downloadResponse(
      await operations.readEditorFile(services(c), { fileId: c.req.param('fileId') }),
      c.req.raw,
    )
  })
  api.delete('/uploads/:fileId', async (c) => {
    await operations.discardEditorUpload(services(c), { fileId: c.req.param('fileId') })
    return c.body(null, 204)
  })
  api.get('/me', (c) => c.json({ data: c.get('user') }))
  api.get('/navigation', async (c) =>
    c.json({ data: await loadNavigation(c.env.db, c.get('user').id) }),
  )
  api.get('/boards', async (c) => c.json({ data: await listBoards(c.env.db, c.get('user').id) }))
  api.post('/boards', async (c) => {
    return c.json(
      { data: await operations.createUserBoard(services(c), await json(c.req.raw)) },
      201,
    )
  })
  api.get('/cards', async (c) => {
    return c.json(await operations.searchCards(services(c), new URL(c.req.url).searchParams))
  })
  api.get('/boards/:boardId', async (c) =>
    c.json({ data: await loadBoardData(c.env.db, c.get('board')) }),
  )
  api.put('/boards/:boardId/watch', async (c) => {
    await operations.watchBoard({ ...services(c), board: c.get('board') }, await json(c.req.raw))
    return c.body(null, 204)
  })
  api.patch('/boards/:boardId', async (c) => {
    await operations.renameBoard({ ...services(c), board: c.get('board') }, await json(c.req.raw))
    return c.body(null, 204)
  })
  api.delete('/boards/:boardId', async (c) => {
    await operations.removeBoard({ ...services(c), board: c.get('board') })
    return c.body(null, 204)
  })
  api.post('/boards/:boardId/columns', async (c) => {
    return c.json(
      {
        data: await operations.createBoardColumn(
          { ...services(c), board: c.get('board') },
          await json(c.req.raw),
        ),
      },
      201,
    )
  })
  api.patch('/boards/:boardId/columns/:columnId', async (c) => {
    await operations.updateBoardColumn(
      { ...services(c), board: c.get('board') },
      { columnId: c.req.param('columnId') },
      await json(c.req.raw),
    )
    return c.body(null, 204)
  })
  api.post('/boards/:boardId/columns/:columnId/position', async (c) => {
    await operations.reorderBoardColumn(
      { ...services(c), board: c.get('board') },
      { columnId: c.req.param('columnId') },
      await json(c.req.raw),
    )
    return c.body(null, 204)
  })
  api.delete('/boards/:boardId/columns/:columnId', async (c) => {
    await operations.removeBoardColumn(
      { ...services(c), board: c.get('board') },
      { columnId: c.req.param('columnId') },
    )
    return c.body(null, 204)
  })
  api.post('/boards/:boardId/cards', async (c) => {
    return c.json(
      {
        data: await operations.createBoardCard(
          { ...services(c), board: c.get('board') },
          await json(c.req.raw),
        ),
      },
      201,
    )
  })
  api.get('/boards/:boardId/cards/:cardId', async (c) => {
    let id = c.req.param('cardId')
    return c.json({ data: await loadCard(c.env.db, c.get('board').id, id) })
  })
  api.patch('/boards/:boardId/cards/:cardId', async (c) => {
    await operations.updateBoardCard(
      { ...services(c), board: c.get('board'), card: c.get('card') },
      { cardId: c.req.param('cardId') },
      await json(c.req.raw),
    )
    return c.body(null, 204)
  })
  api.delete('/boards/:boardId/cards/:cardId', async (c) => {
    await operations.removeBoardCard(
      { ...services(c), board: c.get('board'), card: c.get('card') },
      { cardId: c.req.param('cardId') },
    )
    return c.body(null, 204)
  })
  api.post('/boards/:boardId/cards/:cardId/cover', async (c) => {
    return c.json(
      {
        data: await operations.setCardCover(
          { ...services(c), board: c.get('board'), card: c.get('card') },
          await multipart(c.req.raw),
        ),
      },
      201,
    )
  })
  api.get('/boards/:boardId/cards/:cardId/cover', async (c) => {
    return downloadResponse(
      await operations.readCardCover({
        ...services(c),
        board: c.get('board'),
        card: c.get('card'),
      }),
      c.req.raw,
    )
  })
  api.delete('/boards/:boardId/cards/:cardId/cover', async (c) => {
    await operations.removeCardCover({ ...services(c), board: c.get('board'), card: c.get('card') })
    return c.body(null, 204)
  })
  api.post('/boards/:boardId/cards/:cardId/files', async (c) => {
    return c.json(
      {
        data: await operations.uploadCardFile(
          { ...services(c), board: c.get('board'), card: c.get('card') },
          { cardId: c.req.param('cardId') },
          await multipart(c.req.raw),
        ),
      },
      201,
    )
  })
  api.get('/boards/:boardId/files/:fileId', async (c) => {
    return downloadResponse(
      await operations.readBoardFile(
        { ...services(c), board: c.get('board') },
        { fileId: c.req.param('fileId') },
      ),
      c.req.raw,
    )
  })
  api.delete('/boards/:boardId/files/:fileId', async (c) => {
    await operations.removeBoardFile(
      { ...services(c), board: c.get('board') },
      { fileId: c.req.param('fileId') },
    )
    return c.body(null, 204)
  })
  api.post('/boards/:boardId/cards/:cardId/steps', async (c) => {
    return c.json(
      {
        data: await operations.createCardStep(
          { ...services(c), board: c.get('board'), card: c.get('card') },
          { cardId: c.req.param('cardId') },
          await json(c.req.raw),
        ),
      },
      201,
    )
  })
  api.patch('/boards/:boardId/cards/:cardId/steps/:stepId', async (c) => {
    await operations.updateCardStep(
      { ...services(c), board: c.get('board'), card: c.get('card') },
      { stepId: c.req.param('stepId'), cardId: c.req.param('cardId') },
      await json(c.req.raw),
    )
    return c.body(null, 204)
  })
  api.delete('/boards/:boardId/cards/:cardId/steps/:stepId', async (c) => {
    await operations.removeCardStep(
      { ...services(c), board: c.get('board'), card: c.get('card') },
      { stepId: c.req.param('stepId'), cardId: c.req.param('cardId') },
    )
    return c.body(null, 204)
  })
  api.post('/boards/:boardId/cards/:cardId/comments', async (c) => {
    return c.json(
      {
        data: await operations.createCardComment(
          { ...services(c), board: c.get('board'), card: c.get('card') },
          { cardId: c.req.param('cardId') },
          await json(c.req.raw),
        ),
      },
      201,
    )
  })
  api.delete('/boards/:boardId/cards/:cardId/comments/:commentId', async (c) => {
    await operations.removeCardComment(
      { ...services(c), board: c.get('board'), card: c.get('card') },
      { commentId: c.req.param('commentId'), cardId: c.req.param('cardId') },
    )
    return c.body(null, 204)
  })
  api.use('/tokens/*', async (c, next) => {
    if (c.get('tokenAuth'))
      throw new HTTPException(403, {
        message: 'Manage tokens from a signed-in browser',
      })
    await next()
  })
  api.get('/tokens', async (c) => {
    return c.json({ data: await operations.listAccessTokens(services(c)) }, 200)
  })
  api.post('/tokens', async (c) => {
    return c.json(
      { data: await operations.createAccessToken(services(c), await json(c.req.raw)) },
      201,
    )
  })
  api.delete('/tokens/:tokenId', async (c) => {
    await operations.revokeAccessToken(services(c), { tokenId: c.req.param('tokenId') })
    return c.body(null, 204)
  })
  api.notFound((c) => c.json({ error: 'Endpoint not found' }, 404))
  api.onError((error, c) => {
    if (error instanceof HTTPException || error instanceof OperationError)
      return c.json({ error: error.message }, error.status)
    if (error instanceof DataTableValidationError) return c.json({ error: 'Invalid input' }, 422)
    console.error(
      'API request failed',
      error,
      error instanceof Error ? String(error.cause ?? '') : '',
    )
    return c.json({ error: 'Something went wrong. Please try again.' }, 500)
  })
  return api
}

async function json(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/json')
    throw new HTTPException(415, { message: 'Send application/json' })
  try {
    let value = await request.json()
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error()
    return value
  } catch {
    throw new HTTPException(400, { message: 'Invalid JSON object' })
  }
}

function services(c: Context<Env>) {
  return { db: c.env.db, uploads: c.env.uploads, user: c.get('user') }
}
async function multipart(request: Request) {
  try {
    return await request.formData()
  } catch {
    throw new HTTPException(400, { message: 'Choose a file to upload' })
  }
}
async function downloadResponse(download: StoredDownload, request: Request) {
  let response = await createFileResponse(download.file, request, {
    cacheControl: 'private, no-store',
  })
  response.headers.set(
    'Content-Disposition',
    download.disposition +
      (download.name ? `; filename*=UTF-8''${encodeURIComponent(download.name)}` : ''),
  )
  response.headers.set('X-Content-Type-Options', 'nosniff')
  if (download.sandbox)
    response.headers.set('Content-Security-Policy', "default-src 'none'; sandbox")
  return response
}
