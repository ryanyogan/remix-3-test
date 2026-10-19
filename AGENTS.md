# Trellix Agent Guide

This pnpm workspace contains `apps/web` (Remix 3), `apps/api` (Hono), and shared packages. Keep the API independent of the web router and renderer. The API is for consumers and the CLI; the app must use Remix routes/actions and shared database operations directly, never use the consumer API for app data. The local server may forward consumer requests to the separate API process. Paths in the Remix layout below are relative to `apps/web`.

## Commands

```sh
npm i
npm run dev
npm run hmr
npm run start
npm test
npm run typecheck
```

Use `pnpm hmr` or `pnpm dev` to start separate API and web processes with live updates. `pnpm start` starts both in production mode. `pnpm run doctor` checks the Remix app. Migrations live in `packages/data/migrations`; local SQLite and uploads remain in root `db/` and `uploads/`.

## Building Features

Refer to ./.agents/skills/remix/SKILL.md for the Remix mental model and how to find guides and API READMEs through `node_modules/remix/INDEX.md`.

## UI Design Reference

Use the official [Fizzy repository](https://github.com/basecamp/fizzy) as the reference for UI design and functionality when building or refining Fizzy-inspired features. Check its actual styles, components, and interaction behavior as needed, alongside the user's screenshots and the live app at https://app.fizzy.do/6099243/. Verify typography, spacing, and popup sizing against the source rather than estimating CSS dimensions from screenshots. Adapt the behavior to Trellix's Remix architecture and available features.

## Starter Layout

- `app/routes.ts` defines the shared route contract used by server and browser modules for type-safe hrefs
- `app/router.ts` wires routes to controllers and installs the standard Remix component renderer used by actions
- Put top-level route actions in `app/actions/controller.tsx`; add `app/actions/<route-key>/controller.tsx` for nested route maps. `app/actions/controller.test.ts` is the root controller's router smoke test
- `app/actions/home-page.tsx` and `app/actions/document.tsx` render the route-owned starter UI
- `app/actions/public/` contains the browser runtime entry and interactive prompt button
- `app/assets.ts` owns the server-side asset pipeline used by the asset route and render middleware
- Root `public/` contains static files served unchanged from the app root

This starter intentionally begins small; add directories like `app/data/`, `app/middleware/`, `app/ui/`, and `test/` only when you need them.

## Cloudflare Deployment

Production uses `trellix` (web) and `trellix-api` (Hono), configured separately in each app’s `cloudflare.config.ts`. Build and deploy both with Vite through the `cf` CLI (not Wrangler). Cloudflare routes `trellix.yogan.dev/api/v1*` directly to the API Worker; `api.trellix.yogan.dev` is its additional public hostname.

```sh
pnpm cf:migrate        # apply packages/data/migrations to the remote D1 database
pnpm cf:deploy         # deploy API, then web (flags apply to both)
pnpm cf:dev            # web Worker preview; use pnpm hmr for the complete local app
npx wrangler tail trellix   # live logs (cf cannot stream logs yet)
```

- `app/platform/cloudflare/` holds the Worker entry and Worker versions of Node-only modules. `vite-plugin.ts` swaps them in at build time for `app/db.ts` (D1), `app/data/uploads.ts` (R2), `app/assets.ts` (prebuilt manifest), and `remix/middleware/static`. Keep the swapped modules' exports in sync.
- `scripts/build-cloudflare-assets.ts` prebuilds the asset server output; the Worker serves `/assets/*` from Static Assets itself to set module MIME types and immutable caching.
- D1 has no interactive transactions: writes inside `db.transaction()` are queued and committed with one atomic `batch()`, reads inside the callback do not see them, and `returning` writes are rejected there.
- Workers forbid random values, timers, and I/O at module scope; create them lazily inside handlers.
- `SESSION_SECRET` is a Worker secret shared by both services. Rotate it on both `trellix` and `trellix-api` together (signs everyone out).

- The API has its own tests and request handler; do not mount it in the Remix router. Keep shared types and browser limits in `packages/contracts`. D1/R2 implementations live in `packages/data`.
- Browser verification uses Chromium CDP with actual pointer/keyboard input; do not use Playwright.
