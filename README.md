# Trellix

A compact kanban app built with Remix 3, a Hono JSON API, two independently deployed Cloudflare Workers, D1, and R2. Production: https://trellix.yogan.dev.

## Workspace

- `apps/web`: Remix rendering, browser UI, authentication pages, and static assets.
- `apps/api`: Hono routes, authentication enforcement, API tests, and a separate Worker entrypoint.
- `packages/data`: shared schema, domain operations, D1/R2 adapters, and migrations.
- `packages/contracts`: browser-safe types and limits.
- `packages/session`: signed-cookie contract shared by the independent services.

The API has no import of the web app or its router, assets, or UI. Shared data utilities are used by both services. Both Workers bind the existing D1 database and R2 bucket. `SESSION_SECRET` must match on both Workers; changing it signs out existing browser sessions. Secrets are deployed through Cloudflare, never bundled into browser assets. For an initial deployment or rotation, use `pnpm cf:deploy --secrets-file /absolute/path/to/secrets.env` so both Workers receive the same signing secret in one release. Routine deployments retain their existing secrets.

## Workflows

- A dated home activity feed with Added, Updated, and Done columns, board/person/tag filters, pinned activity, and a searchable center navigation dialog; progress reports live in Insights.
- Boards and custom columns, persistent column collapse, optimistic card creation/movement, drag-and-drop, and attachments.
- Full-page board creation and explicit confirmation before deleting a board or card.
- Card descriptions, tags, priorities, pinning, snoozing, checklists, and comments.
- Instant board filtering; cross-board search includes descriptions and tags.
- Keyboard shortcuts: `J` opens primary navigation; `1–3` select its shortcuts when the filter is empty. `C` opens full-page card creation (using the current board when applicable), `B` opens board creation, `P` opens pinned activity, and `K` or `Ctrl/⌘ K` searches all boards. On a board, `/` or `F` filters and `N` adds a card. Typing in an editor does not trigger letter shortcuts.
- Dark/light themes, responsive boards, and keyboard-accessible native card dialogs.
- Revocable personal access tokens in Account; only SHA-256 token hashes are stored.

This is a Fizzy-inspired personal workflow, not complete Fizzy parity. Shared-board membership, notifications, public sharing, reactions, auto-close, and webhook delivery are not implemented. Personal boards support self-assignment; descriptions and comments support sanitized rich text. The API is Trellix-native, not compatible with Fizzy clients.

## API

Read `/api` for the API guide. `apps/api` is a standalone Hono service deployed as `trellix-api`. Cloudflare routes `trellix.yogan.dev/api/v1*` directly to that Worker; requests do not enter the Remix Worker. API clients can also use `https://api.trellix.yogan.dev/api/v1`. Hono independently verifies signed, expiring browser sessions or bearer tokens. Browser writes require a matching Origin header. The Remix service in `apps/web` serves pages and progressive-enhancement form actions; interactive board mutations use Hono.

```sh
curl https://trellix.yogan.dev/api/v1/boards \
  -H "Authorization: Bearer YOUR_TOKEN"
```

Boards, columns, cards, checklists, comments, search, and attachments are available through the API. JSON bodies are limited to 64 KB; multipart files to 10 MB. Search orders newest first and returns stable creation-time/ID cursors with at most 100 results per page. Token management requires a browser session. Responses are private and no-store; `Server-Timing` exposes API duration.

## Performance choices

- Server-rendered initial board; optimistic mutations refresh JSON rather than re-rendering a whole document.
- Descriptions, steps, and comments are fetched when opening a card. Board payloads contain summaries.
- Local board filtering makes no network requests; global search debounces and cancels superseded requests.
- Workspace responses cap recent cards at 24 and pins at 12, with three previews per board. Same-card writes are serialized to prevent out-of-order saves while unrelated cards remain concurrent.
- Dashboard counts aggregate in SQL; attachment grouping uses a map instead of scanning all files for each card.
- Indexed card relationships and column ordering, atomic D1 write batches, smart Worker placement, and immutable fingerprinted assets.

These are implementation improvements, not a claim of measured superiority over Fizzy. Large boards still load their entire card summary list; virtualization and full-text indexing may be useful at larger scales.

## Development

```sh
pnpm install
pnpm hmr         # live server and browser updates
pnpm dev         # same two-service development environment
pnpm start       # production mode; SESSION_SECRET required
pnpm test
pnpm typecheck
pnpm run doctor
```

Local development starts separate web and API processes, using SQLite in `db/app.sqlite`. The API applies shared migrations before the web process starts. `PORT` defaults to 44100; `API_PORT` defaults to PORT + 10. The Node web server proxies `/api/v1/*` to the API process; in production Cloudflare routes those requests directly. Browser checks use Chromium directly, without Playwright. With an isolated Chromium session on CDP port 9334 signed into a test account, run `QA_ORIGIN=http://localhost:44100 pnpm test:browser`. The check drives pointer and keyboard input through full-page card creation, rich-text formatting and persistence, editing, steps, comments, tags, pinning, completion, and board navigation; it deletes the card it creates. `QA_ORIGIN=http://localhost:44100 pnpm test:browser:workspace` also checks board creation, pinning, home deep links, persistent column collapse, mobile overflow, and confirmed board deletion; it cleans up its test board.

The home navigation check, `QA_ORIGIN=http://localhost:44100 pnpm test:browser:home`, covers jump filtering, shortcuts, focus restoration, card creation, completion activity, board filtering, and mobile dialog bounds. It cleans up its test board.

## Cloudflare

```sh
pnpm cf:deploy --dry-run
pnpm cf:migrate
pnpm cf:deploy
```

Deployment uses `cf` and Vite, with separate `apps/api/cloudflare.config.ts` and `apps/web/cloudflare.config.ts` configurations. `pnpm cf:deploy` deploys API first, then web; `--dry-run` applies to both. Use `pnpm cf:deploy:api` or `pnpm cf:deploy:web` for independent releases. Cloudflare adapters in `apps/web/app/platform/cloudflare/` replace the local database, uploads, and asset server. D1 transaction callbacks queue writes into an atomic batch; reads inside the callback do not see queued writes. `db.update()` implicitly returns a row, so use `tx.query(table).where(...).update(...)` for non-returning updates inside D1 batches. Keep new migrations additive when rolling out to an existing Worker.

The full-page card editor adds migration `0008_card_rich_text`; creation controls add `0009_card_creation_controls` for assignment and cover images. Apply both before deploying the API and web Workers. It adds sanitized rich HTML alongside existing plain-text descriptions/comments, preserving search, activity previews, and older API clients.

The card-workflow release adds migration `0006_card_workflows`. The activity home adds `0007_card_activity`; apply it before deploying the new API and web Workers. Creation and comment history use existing timestamps. Completion and move history starts when the new version records those actions; historical completion dates are not inferred. Existing boards, cards, and files are preserved. Older app versions can continue to use the original tables after this migration.

## Reference

The implementation follows the installed Remix documentation, [Hono's Cloudflare guide](https://hono.dev/docs/getting-started/cloudflare-workers), and [Cloudflare's D1 indexing guidance](https://developers.cloudflare.com/d1/best-practices/use-indexes/). Feature comparison used [Fizzy's help guide](https://help.fizzy.do/3/fizzy-help-guide) and [API overview](https://github.com/basecamp/fizzy/blob/main/docs/api/README.md).

The activity and navigation redesign references [Fizzy’s jump menu](https://github.com/basecamp/fizzy/blob/main/app/views/my/menus/_jump.html.erb) and [event styles](https://github.com/basecamp/fizzy/blob/main/app/assets/stylesheets/events.css). Fizzy uses [Lexxy](https://github.com/basecamp/lexxy), built on Lexical, for rich text. The full-page card route now uses Lexxy 1.0.1 for descriptions and comments. `apps/web/scripts/build-editor.mjs` compiles Lexxy and its CommonJS syntax highlighters to browser ESM before development, tests, and Cloudflare builds. Vendored editor CSS and its MIT license live in `apps/web/app/actions/public/lexxy/`.

Card-page scope: creating/editing titles and rich descriptions, formatted comments, steps,
tags, self-assignment, cover-image upload/removal, pinning, and board/column changes are functional. New-card tags, steps, and assignment save with the card. Create card returns to the board; Create and add another opens a fresh card on the same board. Cover-image selection previews locally and uploads on creation; unsaved drafts are not persisted across reloads. Inline editor images/files upload immediately through the private API and the existing R2 adapter; toolbar selection, pasted files, and drag-and-drop share the same upload path. Saves wait for uploads; failures offer retry/removal. Golden tickets, watching/subscriber notifications, and reactions remain unavailable. The right-hand status list uses the actual
board columns; the six-character card reference comes from its existing UUID. Automatic
"Not Now" aging is not implemented, so the UI does not promise a scheduled move.

Card creation references [Fizzy’s draft container](https://github.com/basecamp/fizzy/blob/main/app/views/cards/drafts/_container.html.erb), [publish actions](https://github.com/basecamp/fizzy/blob/main/app/controllers/cards/publishes_controller.rb), and board/tag/assignment pickers. Cover, tag, and assignment SVG paths come from its official assets. `QA_ORIGIN=http://localhost:44100 node scripts/card-creation-browser-check.mjs` verifies both creation actions, picker filtering, placeholders, cover uploads, draft metadata, board moves, and mobile bounds, and removes its temporary boards.

Editor uploads add migration `0010_editor_uploads`; apply it before deploying both Workers. Pending objects belong to the uploading user and are claimed atomically with card/comment writes into the existing attachment table. Discarded editor uploads are removed; abandoned uploads expire after 24 hours and their objects are reclaimed on that user’s next upload. Downloads remain authenticated. Images use recognized PNG/JPEG/GIF/WebP bytes; other formats download as attachments. Limits remain 10 MB per file and 10 files per card. No public R2 bucket or browser credentials are needed. The integration follows the installed Lexxy pending-attachment API and [Cloudflare’s R2 Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/).

`QA_ORIGIN=http://localhost:44100 node scripts/editor-upload-browser-check.mjs` verifies image/file toolbar uploads, persistence, downloads, comments, offline failures, retry, and cleanup using Chromium CDP. It creates and removes its own board and files. API coverage also exercises the production R2 storage adapter with a test binding; no production upload or deployment is performed by these checks.
