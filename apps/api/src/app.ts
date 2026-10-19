import { columnColors, type ColumnColor } from '@trellix/contracts'
import { loadCard } from '@trellix/data/cards'
import { claimEditorFiles, findEditorFile, prepareEditorFiles, previewTypes, pruneEditorUploads, safeFileType, type EditorFile } from '@trellix/data/editor-uploads'
import { richText, attachmentIds } from '@trellix/data/rich-text'
import { Hono } from "hono";
import { loadWorkspace } from "@trellix/data/workspace";
import { loadNavigation, movementKind, recordActivity } from "@trellix/data/activity";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import {
  DataTableValidationError,
  rawSql,
  sql,
  type Database,
} from "remix/data-table";
import { createFileResponse } from "remix/response/file";
import { limits } from "@trellix/data/limits";
import type { FileStorage } from "remix/file-storage";
import {
  boards,
  boardItems,
  boardItemFiles,
  type User,
  type Board,
  type BoardItem,
} from "@trellix/data/tables";
import {
  attachFile,
  createBoard,
  deleteColumn,
  moveColumn,
  listBoards,
  loadBoardData,
  removeStoredFiles,
  upsertColumn,
  upsertItem,
} from "@trellix/data/boards";
import {
  booleanField,
  numberField,
  textField,
  tokenHash,
} from "./validation.ts";

type Env = {
  Bindings: {
    db: Database;
    uploads: FileStorage;
    sessionUserId: string | null;
    browserOrigin?: string;
  };
  Variables: { user: User; board: Board; card: BoardItem; tokenAuth: boolean };
};

export function createApi() {
  let api = new Hono<Env>().basePath("/api/v1");
  api.use("*", async (c, next) => {
    let start = performance.now();
    c.header("Cache-Control", "private, no-store");
    c.header("X-Content-Type-Options", "nosniff");
    await next();
    c.header(
      "Server-Timing",
      `api;dur=${(performance.now() - start).toFixed(1)}`,
    );
  });
  api.get("/health", (c) => c.json({ status: "ok", version: 1 }));
  api.use("*", (c, next) =>
    bodyLimit({
      maxSize:
        c.req.method === "POST" &&
        (c.req.path === "/api/v1/uploads" || /^\/api\/v1\/boards\/[^/]+\/cards\/[^/]+\/(?:files|cover)$/.test(c.req.path))
          ? limits.fileBytes + 64 * 1024
          : 64 * 1024,
      onError: (c) => c.json({ error: "Request is too large" }, 413),
    })(c, next),
  );
  api.use("*", async (c, next) => {
    let authorization = c.req.header("Authorization");
    let userId = c.env.sessionUserId;
    let hash = "";
    c.set("tokenAuth", Boolean(authorization));
    if (authorization) {
      let token = /^Bearer (trx_[a-f0-9]{64})$/.exec(authorization)?.[1];
      if (!token)
        throw new HTTPException(401, { message: "Invalid access token" });
      hash = await tokenHash(token);
    } else if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
      let origin = c.req.header("Origin");
      if (
        !origin ||
        origin !== (c.env.browserOrigin ?? new URL(c.req.url).origin) ||
        c.req.header("Sec-Fetch-Site") === "cross-site"
      ) {
        throw new HTTPException(403, {
          message: "A same-origin request or bearer token is required",
        });
      }
    }
    if (!hash && !userId)
      throw new HTTPException(401, {
        message: "Sign in or supply a bearer token",
      });
    // Resolve identity and resource ownership in one indexed query. Keeping these checks
    // together avoids three serial D1 round trips before a card can even be read.
    let match = /^\/api\/v1\/boards\/([^/]+)(?:\/cards\/([^/]+))?/.exec(
      c.req.path,
    );
    let boardId = match ? decodeURIComponent(match[1]) : "";
    let cardId = match?.[2] ? decodeURIComponent(match[2]) : "";
    let lookup = await c.env.db.exec(sql`
      select u.id, u.email, u.name, u.created_at,
        b.id as board_id, b.name as board_name, b.color, b.created_at as board_created_at,
        i.id as card_id, i.column_id, i.title, i.position, i.created_at as card_created_at
      from users u
      left join boards b on b.user_id = u.id and b.id = ${boardId}
      left join board_items i on i.board_id = b.id and i.id = ${cardId}
      where u.id = case when ${hash} != ''
        then (select user_id from api_tokens where token_hash = ${hash}) else ${userId} end
    `);
    let row = lookup.rows?.[0];
    if (!row)
      throw new HTTPException(401, {
        message: "Sign in or supply a bearer token",
      });
    c.set("user", {
      id: String(row.id),
      email: String(row.email),
      name: String(row.name),
      created_at: Number(row.created_at),
    });
    if (boardId) {
      if (!row.board_id)
        throw new HTTPException(404, { message: "Board not found" });
      c.set("board", {
        id: boardId,
        user_id: String(row.id),
        name: String(row.board_name),
        color: String(row.color),
        created_at: Number(row.board_created_at),
      });
    }
    if (cardId) {
      if (!row.card_id)
        throw new HTTPException(404, { message: "Card not found" });
      c.set("card", {
        id: cardId,
        board_id: boardId,
        column_id: String(row.column_id),
        title: String(row.title),
        position: Number(row.position),
        created_at: Number(row.card_created_at),
      });
    }
    await next();
  });
  api.get("/workspace", async (c) =>
    c.json({ data: await loadWorkspace(c.env.db, c.get("user").id) }),
  );
  api.post("/uploads", async (c) => {
    let form: FormData;
    try { form = await c.req.raw.formData(); } catch { throw new HTTPException(400, { message: 'Choose a file to upload' }); }
    let file = form.get('file');
    if (!(file instanceof File) || !file.size || file.size > limits.fileBytes || form.getAll('file').length !== 1)
      throw new HTTPException(422, { message: `Choose one nonempty file of at most ${limits.fileLabel}` });
    let userId = c.get('user').id;
    await pruneEditorUploads(c.env.db, c.env.uploads, userId);
    let id = crypto.randomUUID(), name = file.name.trim().slice(0, limits.fileName) || 'file';
    let type = await safeFileType(file);
    try {
      await c.env.uploads.set(id, new File([file], name, { type }));
      let result = await c.env.db.exec(sql`insert into editor_uploads(id, user_id, name, type, size, created_at)
        select ${id}, ${userId}, ${name}, ${type}, ${file.size}, ${Date.now()}
        where (select count(*) from editor_uploads where user_id = ${userId}) < 50 returning id`);
      if (!result.rows?.length) throw new HTTPException(422, { message: 'Finish or discard your pending uploads before adding more.' });
    } catch (error) { await c.env.uploads.remove(id); throw error; }
    return c.json({ data: { id, signed_id: id, attachable_sgid: id, filename: name, byte_size: file.size, content_type: type, previewable: previewTypes.has(type), url: `/api/v1/files/${id}` } }, 201);
  });
  api.get("/files/:fileId", async (c) => {
    let file = await findEditorFile(c.env.db, c.get('user').id, c.req.param('fileId'));
    let stored = file && await c.env.uploads.get(file.id);
    if (!file || !stored) throw new HTTPException(404, { message: 'File not found' });
    let response = await createFileResponse(stored, c.req.raw, { cacheControl: 'private, no-store' });
    response.headers.set('Content-Disposition', `${previewTypes.has(file.type) ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.name)}`);
    response.headers.set('X-Content-Type-Options', 'nosniff');
    // Files uploaded through older clients may have unverified MIME metadata.
    // The inline image path is confined by a restrictive document policy as well.
    response.headers.set('Content-Security-Policy', "default-src 'none'; sandbox");
    return response;
  });
  api.delete("/uploads/:fileId", async (c) => {
    let result = await c.env.db.exec(sql`select id from editor_uploads where id = ${c.req.param('fileId')} and user_id = ${c.get('user').id}`);
    if (result.rows?.length) {
      await c.env.uploads.remove(c.req.param('fileId'));
      await c.env.db.exec(sql`delete from editor_uploads where id = ${c.req.param('fileId')} and user_id = ${c.get('user').id}`);
    }
    return c.body(null, 204);
  });
  api.get("/me", (c) => c.json({ data: c.get("user") }));
  api.get("/navigation", async (c) => c.json({ data: await loadNavigation(c.env.db, c.get("user").id) }));
  api.get("/boards", async (c) =>
    c.json({ data: await listBoards(c.env.db, c.get("user").id) }),
  );
  api.post("/boards", async (c) => {
    let input = await json(c.req.raw);
    let name = textField(input.name, "Name", 100);
    let id = await createBoard(c.env.db, c.get("user").id, { name });
    return c.json({ data: { id, name } }, 201);
  });
  api.get("/cards", async (c) => {
    let q = textField(c.req.query("q") ?? "", "Search", 200, true);
    let limit = Math.floor(
      Math.min(100, Math.max(1, Number(c.req.query("limit") ?? 50) || 50)),
    );
    let after = c.req.query("after") ?? "";
    let separator = after.indexOf(":");
    let afterTime = after
      ? Number(after.slice(0, separator))
      : Number.MAX_SAFE_INTEGER;
    let afterId = after ? after.slice(separator + 1) : "";
    if (after && (separator < 1 || !Number.isFinite(afterTime) || !afterId))
      throw new HTTPException(422, { message: "Invalid search cursor" });
    let pattern = `%${q.replace(/[!%_]/g, "!$&")}%`;
    let result = await c.env.db.exec(sql`
      select i.id, i.title, i.board_id, i.column_id, i.created_at, b.name as board_name,
        b.color, co.name as column_name, coalesce(d.tags, '[]') as tags,
        coalesce(d.pinned, 0) as pinned, coalesce(d.priority, 'normal') as priority
      from boards b join board_items i on i.board_id = b.id
      join board_columns co on co.id = i.column_id
      left join card_details d on d.item_id = i.id
      where b.user_id = ${c.get("user").id} and (${after} = '' or i.created_at < ${afterTime} or (i.created_at = ${afterTime} and i.id < ${afterId}))
        and (${q} = '' or i.title like ${pattern} escape '!' or d.description like ${pattern} escape '!' or d.tags like ${pattern} escape '!')
        and (${c.req.query("pinned") ?? ""} != 'true' or d.pinned = 1)
        and (${c.req.query("boardId") ?? ""} = '' or b.id = ${c.req.query("boardId") ?? ""})
      order by i.created_at desc, i.id desc limit ${Math.floor(limit) + 1}
    `);
    let rows = result.rows ?? [];
    let more = rows.length > limit;
    let data = rows
      .slice(0, limit)
      .map((row) => ({ ...row, tags: JSON.parse(String(row.tags)) }));
    return c.json({
      data,
      next: more ? `${rows[limit - 1].created_at}:${rows[limit - 1].id}` : null,
    });
  });
  api.get("/boards/:boardId", async (c) =>
    c.json({ data: await loadBoardData(c.env.db, c.get("board")) }),
  );
  api.put('/boards/:boardId/watch', async (c) => {
    let input = await json(c.req.raw);
    let watching = booleanField(input.watching, 'Watching');
    await c.env.db.exec(sql`insert into board_watches(board_id, watching, since)
      values (${c.get('board').id}, ${watching ? 1 : 0}, ${Date.now()})
      on conflict(board_id) do update set watching = excluded.watching, since = excluded.since`);
    return c.body(null, 204);
  });
  api.patch("/boards/:boardId", async (c) => {
    let input = await json(c.req.raw);
    await c.env.db.update(boards, c.get("board").id, {
      name: textField(input.name, "Name", 100),
    });
    return c.body(null, 204);
  });
  api.delete("/boards/:boardId", async (c) => {
    await removeStoredFiles(c.env.db, c.env.uploads, {
      board_id: c.get("board").id,
    });
    await c.env.db.delete(boards, c.get("board").id);
    return c.body(null, 204);
  });
  api.post("/boards/:boardId/columns", async (c) => {
    let input = await json(c.req.raw);
    let id = clientId(input.id);
    if (
      !(await upsertColumn(c.env.db, c.get("board").id, {
        id,
        name: textField(input.name, "Name", 100),
        color: columnColor(input.color),
      }))
    )
      throw new HTTPException(404, { message: "Column not found" });
    return c.json({ data: { id } }, 201);
  });
  api.patch("/boards/:boardId/columns/:columnId", async (c) => {
    let input = await json(c.req.raw);
    if (
      !(await upsertColumn(c.env.db, c.get("board").id, {
        id: c.req.param("columnId"),
        name: textField(input.name, "Name", 100),
        color: columnColor(input.color),
      }))
    )
      throw new HTTPException(404);
    return c.body(null, 204);
  });
  api.post("/boards/:boardId/columns/:columnId/position", async (c) => {
    let input = await json(c.req.raw);
    if (input.direction !== 'left' && input.direction !== 'right') throw new HTTPException(422, { message: 'Choose left or right' });
    if (!await moveColumn(c.env.db, c.get('board').id, c.req.param('columnId'), input.direction)) throw new HTTPException(422, { message: 'Column cannot move in that direction' });
    return c.body(null, 204);
  });
  api.delete("/boards/:boardId/columns/:columnId", async (c) => {
    await deleteColumn(
      c.env.db,
      c.env.uploads,
      c.get("board").id,
      c.req.param("columnId"),
    );
    return c.body(null, 204);
  });
  api.post("/boards/:boardId/cards", async (c) => {
    let input = await json(c.req.raw);
    let id = clientId(input.id);
    let prepared = input.descriptionHtml === undefined ? undefined : await editorContent(c.env.db, c.get('user').id, id, textField(input.descriptionHtml, "Description", 60000, true));
    let description = prepared?.content;
    if (description && description.text.length > 20000) throw new HTTPException(422, { message: "Keep descriptions to 20000 characters" });
    let tags = input.tags === undefined ? undefined : cardTags(input.tags);
    let assigneeId = input.assigneeId === undefined ? undefined : cardAssignee(input.assigneeId, c.get("user").id);
    if (input.steps !== undefined && (!Array.isArray(input.steps) || input.steps.length > 200)) throw new HTTPException(422, { message: "Use up to 200 steps" });
    let steps = (input.steps as Record<string, unknown>[] | undefined)?.map(step => {
      if (!step || typeof step !== 'object') throw new HTTPException(422, { message: "Invalid step" });
      return { title: textField(step.title, "Step", 300), completed: step.completed === undefined ? false : !!booleanField(step.completed, "Completed") };
    });
    if (
      !(await upsertItem(c.env.db, c.get("board").id, {
        id,
        columnId: textField(input.columnId, "Column", 64),
        title: textField(input.title, "Title", limits.cardTitle),
        description, tags, assigneeId, steps, uploads: prepared ? { userId: c.get("user").id, files: prepared.files } : undefined,
        position:
          input.position === undefined
            ? undefined
            : numberField(input.position, "Position", -Number.MAX_VALUE),
      }))
    )
      throw new HTTPException(404, { message: "Column not found" });
    return c.json({ data: { id } }, 201);
  });
  api.get("/boards/:boardId/cards/:cardId", async (c) => {
    let id = c.req.param("cardId");
    return c.json({ data: await loadCard(c.env.db, c.get("board").id, id) });
  });
  api.patch("/boards/:boardId/cards/:cardId", async (c) => {
    let input = await json(c.req.raw);
    let id = c.req.param("cardId");
    let item = c.get("card");
    let title =
      input.title === undefined
        ? item.title
        : textField(input.title, "Title", limits.cardTitle);
    let boardId = input.boardId === undefined ? item.board_id : textField(input.boardId, "Board", 64);
    if (boardId !== item.board_id) {
      let owned = await c.env.db.findOne(boards, { where: { id: boardId, user_id: c.get("user").id } });
      if (!owned) throw new HTTPException(404, { message: "Board not found" });
    }
    let firstColumn = boardId !== item.board_id ? await c.env.db.exec(sql`select id from board_columns where board_id = ${boardId} order by position, id limit 1`) : null;
    let columnId =
      input.columnId === undefined
        ? String(firstColumn?.rows?.[0]?.id ?? item.column_id)
        : textField(input.columnId, "Column", 64);
    let position =
      input.position === undefined
        ? columnId === item.column_id
          ? Number(item.position)
          : undefined
        : numberField(input.position, "Position", -Number.MAX_VALUE);
    let files: EditorFile[] = [];
    let fields: Record<string, unknown> = {};
    if (input.descriptionHtml !== undefined) {
      let prepared = await editorContent(c.env.db, c.get('user').id, id, textField(input.descriptionHtml, "Description", 60000, true));
      let content = prepared.content; files = prepared.files;
      if (content.text.length > 20000) throw new HTTPException(422, { message: "Keep descriptions to 20000 characters" });
      fields.description = content.text;
      fields.description_html = content.html;
    } else if (input.description !== undefined) {
      fields.description = textField(input.description, "Description", 20000, true);
      fields.description_html = "";
    }
    if (input.tags !== undefined) fields.tags = JSON.stringify(cardTags(input.tags));
    if (input.assigneeId !== undefined) fields.assignee_id = cardAssignee(input.assigneeId, c.get("user").id);
    if (input.pinned !== undefined)
      fields.pinned = booleanField(input.pinned, "Pinned");
    if (input.priority !== undefined) {
      if (!["normal", "high", "urgent"].includes(String(input.priority)))
        throw new HTTPException(422, { message: "Invalid priority" });
      fields.priority = input.priority;
    }
    if (input.snoozedUntil !== undefined)
      fields.snoozed_until = numberField(input.snoozedUntil, "Snooze date");
    // Validate the destination before starting a D1 batch; reads never rely on queued writes.
    let destination = await c.env.db.exec(
      sql`select id, name from board_columns where id = ${columnId} and board_id = ${boardId}`,
    );
    if (!destination.rows?.length)
      throw new HTTPException(404, { message: "Column not found" });
    if (position === undefined) {
      let result = await c.env.db.exec(
        sql`select coalesce(max(position), 0) + 1 as position from board_items where column_id = ${columnId}`,
      );
      position = Number(result.rows![0].position);
    }
    let moved = columnId !== item.column_id;
    let kind = moved ? await movementKind(c.env.db, boardId, columnId) : 'updated' as const;
    // db.update() implicitly requests RETURNING; D1 batches require a non-returning query.
    await c.env.db.transaction(async (tx) => {
      await claimEditorFiles(tx, c.get("user").id, boardId, id, files);
      await tx
        .query(boardItems)
        .where({ id })
        .update({ title, board_id: boardId, column_id: columnId, position });
      if (boardId !== item.board_id) await tx.query(boardItemFiles).where({ item_id: id }).update({ board_id: boardId });
      await tx.exec(sql`insert into card_details(item_id, updated_at) values (${id}, ${Date.now()})
        on conflict(item_id) do update set updated_at = excluded.updated_at`);
      if (Object.keys(fields).length) {
        await tx.exec(
          rawSql(
            `update card_details set ${Object.keys(fields)
              .map((key) => `${key} = ?`)
              .join(", ")} where item_id = ?`,
            [...Object.values(fields), id],
          ),
        );
      }
      if (moved || title !== item.title || Object.keys(fields).length) {
        await recordActivity(tx, id, kind, moved ? String(destination.rows![0].name) : '');
      }
    });
    return c.body(null, 204);
  });
  api.delete("/boards/:boardId/cards/:cardId", async (c) => {
    await removeStoredFiles(c.env.db, c.env.uploads, {
      item_id: c.req.param("cardId"),
    });
    await c.env.db.delete(boardItems, c.req.param("cardId"));
    return c.body(null, 204);
  });
  api.post("/boards/:boardId/cards/:cardId/cover", async (c) => {
    let form: FormData;
    try { form = await c.req.raw.formData(); } catch { throw new HTTPException(400, { message: "Choose an image" }); }
    let file = form.get("file");
    if (!(file instanceof File) || !file.size || file.size > limits.fileBytes || form.getAll("file").length !== 1)
      throw new HTTPException(422, { message: `Choose one image of at most ${limits.fileLabel}` });
    let bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    let valid = file.type === 'image/png' && [137,80,78,71,13,10,26,10].every((b,i) => bytes[i] === b)
      || file.type === 'image/jpeg' && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      || file.type === 'image/webp' && String.fromCharCode(...bytes.slice(0,4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8,12)) === 'WEBP';
    if (!valid) throw new HTTPException(422, { message: "Choose a PNG, JPEG, or WebP image" });
    let card = await loadCard(c.env.db, c.get('board').id, c.get('card').id);
    let id = crypto.randomUUID();
    if (await attachFile(c.env.db, c.env.uploads, c.get('board').id, c.get('card').id, { id, file }) !== 'attached')
      throw new HTTPException(422, { message: "This card cannot accept another file" });
    await c.env.db.exec(sql`insert into card_details(item_id, cover_file_id, updated_at) values (${c.get('card').id}, ${id}, ${Date.now()})
      on conflict(item_id) do update set cover_file_id = excluded.cover_file_id, updated_at = excluded.updated_at`);
    if (card?.cover_file_id) {
      await c.env.uploads.remove(card.cover_file_id);
      await c.env.db.delete(boardItemFiles, card.cover_file_id);
    }
    return c.json({ data: { id } }, 201);
  });
  api.get("/boards/:boardId/cards/:cardId/cover", async (c) => {
    let card = await loadCard(c.env.db, c.get('board').id, c.get('card').id);
    let stored = card?.cover_file_id && await c.env.uploads.get(card.cover_file_id);
    if (!stored) throw new HTTPException(404, { message: "Image not found" });
    let response = await createFileResponse(stored, c.req.raw, { cacheControl: 'private, no-store' });
    response.headers.set('Content-Disposition', 'inline');
    response.headers.set('X-Content-Type-Options', 'nosniff');
    return response;
  });
  api.delete("/boards/:boardId/cards/:cardId/cover", async (c) => {
    let card = await loadCard(c.env.db, c.get('board').id, c.get('card').id);
    if (card?.cover_file_id) {
      await c.env.uploads.remove(card.cover_file_id);
      await c.env.db.delete(boardItemFiles, card.cover_file_id);
    }
    return c.body(null, 204);
  });
  api.post("/boards/:boardId/cards/:cardId/files", async (c) => {
    let form: FormData;
    try {
      form = await c.req.raw.formData();
    } catch {
      throw new HTTPException(400, {
        message: "Send a multipart form with one file field",
      });
    }
    let file = form.get("file");
    if (
      !(file instanceof File) ||
      file.size === 0 ||
      file.size > limits.fileBytes ||
      form.getAll("file").length !== 1
    )
      throw new HTTPException(422, {
        message: `Choose one nonempty file of at most ${limits.fileLabel}`,
      });
    let id = clientId(form.get("id") ?? undefined);
    let result = await attachFile(
      c.env.db,
      c.env.uploads,
      c.get("board").id,
      c.req.param("cardId"),
      { id, file },
    );
    if (result !== "attached")
      throw new HTTPException(422, {
        message: "This card cannot accept another file",
      });
    return c.json({ data: { id, name: file.name, size: file.size } }, 201);
  });
  api.get("/boards/:boardId/files/:fileId", async (c) => {
    let row = await c.env.db.findOne(boardItemFiles, {
      where: { id: c.req.param("fileId"), board_id: c.get("board").id },
    });
    let stored = row && (await c.env.uploads.get(row.id));
    if (!row || !stored)
      throw new HTTPException(404, { message: "File not found" });
    let response = await createFileResponse(stored, c.req.raw, {
      cacheControl: "private, no-store",
    });
    response.headers.set(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(row.name)}`,
    );
    response.headers.set("X-Content-Type-Options", "nosniff");
    return response;
  });
  api.delete("/boards/:boardId/files/:fileId", async (c) => {
    let row = await c.env.db.findOne(boardItemFiles, {
      where: { id: c.req.param("fileId"), board_id: c.get("board").id },
    });
    if (!row) throw new HTTPException(404, { message: "File not found" });
    await c.env.uploads.remove(row.id);
    await c.env.db.delete(boardItemFiles, row.id);
    return c.body(null, 204);
  });
  api.post("/boards/:boardId/cards/:cardId/steps", async (c) => {
    let input = await json(c.req.raw);
    let id = crypto.randomUUID();
    let result = await c.env.db
      .exec(sql`insert into card_steps(id, item_id, title, created_at)
      select ${id}, ${c.req.param("cardId")}, ${textField(input.title, "Step", 300)}, ${Date.now()}
      where (select count(*) from card_steps where item_id = ${c.req.param("cardId")}) < 200 returning id`);
    if (!result.rows?.length)
      throw new HTTPException(422, {
        message: "A card can have up to 200 steps",
      });
    return c.json({ data: { id } }, 201);
  });
  api.patch("/boards/:boardId/cards/:cardId/steps/:stepId", async (c) => {
    let input = await json(c.req.raw);
    await c.env.db
      .exec(sql`update card_steps set completed = ${booleanField(input.completed, "Completed")}
      where id = ${c.req.param("stepId")} and item_id = ${c.req.param("cardId")}`);
    return c.body(null, 204);
  });
  api.delete("/boards/:boardId/cards/:cardId/steps/:stepId", async (c) => {
    await c.env.db.exec(
      sql`delete from card_steps where id = ${c.req.param("stepId")} and item_id = ${c.req.param("cardId")}`,
    );
    return c.body(null, 204);
  });
  api.post("/boards/:boardId/cards/:cardId/comments", async (c) => {
    let input = await json(c.req.raw);
    let prepared = input.bodyHtml === undefined ? null : await editorContent(c.env.db, c.get('user').id, c.req.param('cardId'), textField(input.bodyHtml, "Comment", 30000, true));
    let content = prepared?.content;
    let body = textField(content ? content.text : input.body, "Comment", 10000);
    let id = crypto.randomUUID();
    await c.env.db.transaction(async tx => {
      await claimEditorFiles(tx, c.get('user').id, c.get('board').id, c.req.param('cardId'), prepared?.files ?? []);
      await tx.exec(sql`insert into card_comments(id, item_id, user_id, body, body_html, created_at)
        values (${id}, ${c.req.param("cardId")}, ${c.get("user").id}, ${body}, ${content?.html ?? ''}, ${Date.now()})`);
    });
    return c.json({ data: { id } }, 201);
  });
  api.delete(
    "/boards/:boardId/cards/:cardId/comments/:commentId",
    async (c) => {
      await c.env.db.exec(
        sql`delete from card_comments where id = ${c.req.param("commentId")} and item_id = ${c.req.param("cardId")} and user_id = ${c.get("user").id}`,
      );
      return c.body(null, 204);
    },
  );
  api.use("/tokens/*", async (c, next) => {
    if (c.get("tokenAuth"))
      throw new HTTPException(403, {
        message: "Manage tokens from a signed-in browser",
      });
    await next();
  });
  api.get("/tokens", async (c) => {
    let result = await c.env.db.exec(
      sql`select id, name, created_at from api_tokens where user_id = ${c.get("user").id} order by created_at desc`,
    );
    return c.json({ data: result.rows });
  });
  api.post("/tokens", async (c) => {
    let input = await json(c.req.raw);
    let name = textField(input.name, "Token name", 80);
    let id = crypto.randomUUID();
    let token =
      "trx_" +
      Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
    let hash = await tokenHash(token);
    let result = await c.env.db
      .exec(sql`insert into api_tokens(id, user_id, name, token_hash, created_at)
      select ${id}, ${c.get("user").id}, ${name}, ${hash}, ${Date.now()}
      where (select count(*) from api_tokens where user_id = ${c.get("user").id}) < 20 returning id`);
    if (!result.rows?.length)
      throw new HTTPException(422, {
        message: "Revoke an existing token before creating another (limit 20)",
      });
    return c.json({ data: { id, name, token } }, 201);
  });
  api.delete("/tokens/:tokenId", async (c) => {
    await c.env.db.exec(
      sql`delete from api_tokens where id = ${c.req.param("tokenId")} and user_id = ${c.get("user").id}`,
    );
    return c.body(null, 204);
  });
  api.notFound((c) => c.json({ error: "Endpoint not found" }, 404));
  api.onError((error, c) => {
    if (error instanceof HTTPException)
      return c.json({ error: error.message }, error.status);
    if (error instanceof DataTableValidationError)
      return c.json({ error: "Invalid input" }, 422);
    console.error(
      "API request failed",
      error,
      error instanceof Error ? String(error.cause ?? "") : "",
    );
    return c.json({ error: "Something went wrong. Please try again." }, 500);
  });
  return api;
}

async function json(request: Request): Promise<Record<string, unknown>> {
  if (
    request.headers.get("Content-Type")?.split(";")[0].trim() !==
    "application/json"
  )
    throw new HTTPException(415, { message: "Send application/json" });
  try {
    let value = await request.json();
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error();
    return value;
  } catch {
    throw new HTTPException(400, { message: "Invalid JSON object" });
  }
}

function clientId(value: unknown): string {
  if (value === undefined) return crypto.randomUUID();
  if (
    typeof value !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      value,
    )
  )
    throw new HTTPException(422, { message: "ID must be a UUID" });
  return value;
}

function cardTags(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 12) throw new HTTPException(422, { message: "Use up to 12 tags" });
  return [...new Set(value.map(tag => textField(tag, 'Tag', 30).toLowerCase()))];
}
function cardAssignee(value: unknown, owner: string): string | null {
  // Personal boards currently have one member. Never expose or assign unrelated accounts.
  if (value === null || value === owner) return value;
  throw new HTTPException(422, { message: "Choose a member of this board" });
}

async function editorContent(db: Database, userId: string, cardId: string, html: string) {
  try {
    let ids = attachmentIds(html);
    if (ids.length > limits.filesPerCard) throw new Error(`Use up to ${limits.filesPerCard} files per card.`);
    let files = await prepareEditorFiles(db, userId, cardId, ids);
    return { content: richText(html, files), files };
  } catch (error) {
    if (error instanceof Error && /attachment|files per card/i.test(error.message)) throw new HTTPException(422, { message: error.message });
    throw error;
  }
}

function columnColor(value: unknown): ColumnColor | undefined {
  if (value === undefined) return
  if (!columnColors.includes(value as ColumnColor)) throw new HTTPException(422, { message: 'Choose a column color' })
  return value as ColumnColor
}
