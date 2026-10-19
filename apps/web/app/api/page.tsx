import type { Handle } from 'remix/component'
import { Document } from '../actions/document.tsx'

const endpoints = [
  ['GET', '/workspace', 'Board summaries, three previews per board, 24 recent cards, and 12 pinned cards'],
  ['GET', '/me', 'Your signed-in identity'],
  ['GET / POST', '/boards', 'List or create boards'],
  ['GET / PATCH / DELETE', '/boards/:boardId', 'Read a board snapshot, rename, or delete'],
  ['POST', '/boards/:boardId/columns', 'Create a column: { name }'],
  ['PATCH / DELETE', '/boards/:boardId/columns/:columnId', 'Rename or delete a column'],
  ['GET', '/cards?q=&pinned=true&boardId=&limit=50&after=', 'Search your cards; next is a cursor for another page (maximum 100)'],
  ['POST', '/boards/:boardId/cards', 'Create a card: { title, columnId }'],
  ['GET / PATCH / DELETE', '/boards/:boardId/cards/:cardId', 'Read, edit, move, or delete a card'],
  ['POST', '/boards/:boardId/cards/:cardId/steps', 'Add a checklist step: { title }'],
  ['PATCH / DELETE', '/boards/:boardId/cards/:cardId/steps/:stepId', 'Complete a step: { completed: true }, or delete it'],
  ['POST', '/boards/:boardId/cards/:cardId/comments', 'Add a comment: { body }'],
  ['DELETE', '/boards/:boardId/cards/:cardId/comments/:commentId', 'Remove your comment'],
  ['POST', '/boards/:boardId/cards/:cardId/files', 'Attach one file as multipart/form-data (file field, maximum 10 MB)'],
  ['GET / DELETE', '/boards/:boardId/files/:fileId', 'Download or delete an attachment'],
  ['GET / POST / DELETE', '/tokens or /tokens/:tokenId', 'Manage tokens from a same-origin signed-in browser'],
]

export function ApiPage(_handle: Handle) {
  return () => <Document title="API guide · Trellix"><main class="page" style={{ maxWidth: '1000px', margin: '0 auto' }}>
    <a href="/dashboard/account">← Account & access tokens</a>
    <p class="eyebrow">Trellix / API v1</p><h1 class="page-title">A small API.<br />A lot of possibilities.</h1>
    <p>Create boards, move cards, add steps, and connect your own tools. JSON over HTTP, served by an independent Hono API Worker.</p>
    <section class="panel token-panel"><h2>Get started</h2><p>Create an access token in your account. Send it as a bearer token with each request. Tokens inherit access to all your boards and stay active until revoked.</p>
      <pre style={{ overflowX: 'auto' }}><code>{`curl https://trellix.yogan.dev/api/v1/boards \\\n  -H "Authorization: Bearer YOUR_TOKEN"`}</code></pre>
      <p>Write requests require <code>Content-Type: application/json</code>. Browser sessions also work; writes must include a matching Origin header. The API does not allow cross-origin browser requests.</p>
    </section>
    <section class="panel token-panel"><h2>Edit a card</h2><p>Send only the fields you want to change. Tags are normalized to lowercase. Moving a card to the last column completes it; moving it back reopens it.</p>
      <pre style={{ overflowX: 'auto' }}><code>{JSON.stringify({ title: 'Ship the good stuff', description: 'A little context goes a long way.', columnId: 'COLUMN_ID', tags: ['launch', 'design'], priority: 'high', pinned: true, snoozedUntil: 0 }, null, 2)}</code></pre>
      <p><code>priority</code>: normal, high, or urgent. <code>snoozedUntil</code>: Unix milliseconds, or 0 to wake the card. <code>position</code>: a finite number for ordering within a column.</p>
    </section>
    <section class="panel token-panel"><h2>Endpoints</h2><p>All paths start with <code>/api/v1</code>.</p>
      <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}><thead><tr><th>Method</th><th>Path</th><th>What it does</th></tr></thead><tbody>{endpoints.map(([method, path, description]) => <tr><td style={{ padding: '14px 8px', borderTop: '1px solid var(--line)' }}><code>{method}</code></td><td style={{ padding: '14px 8px', borderTop: '1px solid var(--line)' }}><code>{path}</code></td><td style={{ padding: '14px 8px', borderTop: '1px solid var(--line)' }}>{description}</td></tr>)}</tbody></table></div>
    </section>
    <section class="panel token-panel"><h2>Responses & limits</h2><p>Reads return <code>{'{ "data": … }'}</code>. Creation returns 201; updates and deletes return 204. Errors use <code>{'{ "error": "message" }'}</code>: 400 malformed JSON, 401 unauthenticated, 403 forbidden, 404 missing, 413 too large, 415 incorrect content type, or 422 invalid fields.</p>
      <p>JSON bodies are limited to 64 KB; multipart file uploads to 10 MB. Cards allow 12 tags, 200 steps, and 20,000 characters of description. Card detail returns the latest 100 comments. Search uses stable creation-time/ID cursors, newest first. Responses are private and never stored by shared caches. Server-Timing reports API duration.</p>
      <p>Attachments are available through the board interface and the API. This API is native to Trellix; it is not wire-compatible with the Fizzy API.</p>
    </section>
  </main></Document>
}
