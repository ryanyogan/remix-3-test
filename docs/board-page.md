# Board page reference and implementation

The board was compared with the supplied 2498 × 2598 screenshot and the official Fizzy repository at commit `55bb38335e066b6db13bd0c6c9d2dafce672df6c`. The screenshot represents a 1249 × 1299 CSS-pixel viewport at 2× resolution. Trellix keeps its own branding, users, card identifiers, and board contents.

Reference files:

- [Board Rails template](https://github.com/basecamp/fizzy/blob/55bb38335e066b6db13bd0c6c9d2dafce672df6c/app/views/boards/show.html.erb) and [column layout](https://github.com/basecamp/fizzy/blob/55bb38335e066b6db13bd0c6c9d2dafce672df6c/app/views/boards/show/_columns.html.erb): Not Now, intake, work columns, Done, and the add-column control.
- [Column styles](https://github.com/basecamp/fizzy/blob/55bb38335e066b6db13bd0c6c9d2dafce672df6c/app/assets/stylesheets/card-columns.css): 450px expanded columns, 40px collapsed tabs, 8px gaps, 16px card gutters, count-dependent gradients, and 300ms column transitions. Card text uses the screenshot’s larger size rather than the current upstream .85cqi setting.
- [Card styles](https://github.com/basecamp/fizzy/blob/55bb38335e066b6db13bd0c6c9d2dafce672df6c/app/assets/stylesheets/cards.css): board tab, heavy title, avatar, two-row metadata, comment count, and layered shadows. Hover/focus outlines leave the card in place; pressing a card does not lift it.
- [Column controller](https://github.com/basecamp/fizzy/blob/55bb38335e066b6db13bd0c6c9d2dafce672df6c/app/javascript/controllers/collapsible_columns_controller.js): browser-persisted expansion and closing sibling work columns. Trellix also retains the ability to collapse its intake column.
- [Webhook helper](https://github.com/basecamp/fizzy/blob/55bb38335e066b6db13bd0c6c9d2dafce672df6c/app/helpers/webhooks_helper.rb) and [board helper](https://github.com/basecamp/fizzy/blob/55bb38335e066b6db13bd0c6c9d2dafce672df6c/app/helpers/boards_helper.rb): the globe links to board webhooks, and the gear links to board settings. Trellix’s corresponding routes both verify board ownership.
- [Button states](https://github.com/basecamp/fizzy/blob/55bb38335e066b6db13bd0c6c9d2dafce672df6c/app/assets/stylesheets/buttons.css) and [drag states](https://github.com/basecamp/fizzy/blob/55bb38335e066b6db13bd0c6c9d2dafce672df6c/app/assets/stylesheets/drag_and_drop.css): hover brightness, visible keyboard focus, muted dragged cards, and dashed drop targets.

Implementation is in `apps/web/app/actions/dashboard/boards/public/board.tsx` and `apps/web/app/actions/public/board.css`. Remix client entries own interaction state; Hono continues to own the JSON API. The original Fizzy icons and license are under `apps/web/public/icons/fizzy/`.

Watching is persisted by migration `0011_board_watches`. The Notifications page lists new cards from watched boards. Stopping and restarting watching starts a new notification window. There is no email or push delivery. Not Now becomes a stored column on its first card drop; it is kept before intake, and new work columns are inserted before Done. New and reopened cards skip Not Now when choosing intake. Existing column names are preserved.

Remaining differences for later passes:

- The Board filter switches between owned boards; it does not combine multiple boards into a single result set. Person filters reflect Trellix’s current single-owner model. Status options use available Trellix states (including pinned, urgent, and snoozed); Fizzy’s stalled/closing-soon/golden states are not implemented.
- Webhook configuration and delivery are not implemented. The globe reaches a dedicated Webhooks page with the current availability and a link to the API documentation.
- Column resizing and card landing use CSS transitions. Fizzy’s elastic drag-strum effect and rubber-stamp completion animation are not reproduced.
- Existing card attachment previews and move/attach/delete controls remain available. Full Fizzy keyboard commands remain outside this pass.

Verification: `pnpm typecheck`, `pnpm test`, `pnpm run doctor`, and the web Worker build. `QA_ORIGIN=http://localhost:44100 node scripts/board-browser-check.mjs` uses Chromium CDP pointer/keyboard input, including a native intercepted drag, and creates/deletes its own fixture board. It checks navigation, settings, watching, notifications, filters, expansion persistence, Not Now drops, column order, creation/reopening, mobile bounds, and theme switching.


## Column menus, filters, and edit popup

The October 18 filter-row, column-hover/menu, and color-editor screenshots are implemented in `board-controls.tsx`. Additional source references are Fizzy’s [`filters/settings` partials](https://github.com/basecamp/fizzy/tree/55bb38335e066b6db13bd0c6c9d2dafce672df6c/app/views/filters/settings), [`menu/_column.html.erb`](https://github.com/basecamp/fizzy/blob/55bb38335e066b6db13bd0c6c9d2dafce672df6c/app/views/boards/show/menu/_column.html.erb), [`menu/_column_form.html.erb`](https://github.com/basecamp/fizzy/blob/55bb38335e066b6db13bd0c6c9d2dafce672df6c/app/views/boards/show/menu/_column_form.html.erb), and `popup.css`, `color-picker.css`, `inputs.css`, and `_global.css`.

- Expanded filters provide board navigation, date sorting, status, multiple tags, assignment, creator, closer, and clear/reset. Filters apply to the current loaded board and reset on navigation.
- Hover/focus reveals the dots, collapse glyph, and grid button. The grid opens a shareable `?column=<id>` view with a Back to board link.
- Native popovers stay above scrolling lanes, clamp to viewport edges, close on Escape/outside click, and support arrow-key navigation.
- Work-column menus disable movement at the first/last work column; intake, Not Now, and Done retain their positions. Deletes require confirmation and return cards to intake, preserving attachments.
- The editor selects the existing name and supplies the original nine OKLCH colors, with a three-column radio grid, selected checkmark, focus ring, and full-width save button. Name and color save together. Migration `0012_column_colors` persists colors and cascades on deletion; older columns retain their previous yellow appearance until edited. New work columns default to Fizzy blue. Dark mode uses Fizzy’s corresponding darker palette.

Run `QA_ORIGIN=http://localhost:44100 pnpm run test:browser:board-controls` for CDP verification of filters, disabled actions, selected input text, name/color persistence, reorder, grid navigation, cancellation/deletion, and mobile popup bounds. The script creates and removes its own fixture board. Apply `0012_column_colors` with the normal migration process before deploying this version.
