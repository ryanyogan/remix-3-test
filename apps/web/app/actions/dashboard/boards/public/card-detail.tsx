import { routes } from '../../../../routes.ts'
import { on, ref, type Handle } from "remix/component";
import { limits } from "../../../../data/limits.ts";
import {
  CheckIcon,
  XIcon,
  PaperclipIcon,
} from "../../../../ui/public/icons.tsx";
import { appRequest } from '../../public/app-request.ts';
import type { ColumnData, ItemData } from "./board-model.ts";

interface Detail {
  id: string;
  title: string;
  description: string;
  tags: string[];
  pinned: number;
  priority: string;
  column_id: string;
  snoozed_until: number;
  created_at: number;
  files: Array<{ id: string; name: string; size: number }>;
  steps: Array<{ id: string; title: string; completed: number }>;
  comments: Array<{
    id: string;
    body: string;
    author: string;
    created_at: number;
  }>;
}

export function CardDetail(
  handle: Handle<{
    boardId: string;
    boardName: string;
    cardId: string;
    preview?: ItemData;
    columns: ColumnData[];
    ready(): Promise<void>;
    onClose(): void;
    onChange(): void;
  }>,
) {
  let detail: Detail | undefined;
  let error = "",
    busy = false,
    editing = false,
    loaded = false,
    copied = false;
  let dialog: HTMLDialogElement | undefined;
  let params = () => ({ boardId: handle.props.boardId, cardId: handle.props.cardId });
  async function load() {
    await handle.props.ready();
    detail = await appRequest<Detail>(routes.dashboard.cards.data.href(params()), "GET", undefined, handle.signal);
    error = "";
    if (!handle.signal.aborted) handle.update();
  }
  async function change(href: string, body?: unknown) {
    if (busy) return false;
    busy = true;
    error = "";
    handle.update();
    try {
      await appRequest(href, 'POST', body);
      await load();
      handle.props.onChange();
      return true;
    } catch (e) {
      if (!handle.signal.aborted) error = (e as Error).message;
      return false;
    } finally {
      busy = false;
      if (!handle.signal.aborted) handle.update();
    }
  }
  function close() {
    if (!busy && (!editing || confirm("Discard your unsaved edits?")))
      dialog?.close();
  }
  function edit() {
    editing = true;
    handle.update();
  }
  function date(value: number) {
    let d = new Date(value);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  return () => {
    let doneColumn = handle.props.columns.at(-1);
    let done = Boolean(detail && detail.column_id === doneColumn?.id);
    return (
      <dialog
        class="card-dialog card-sheet"
        aria-labelledby="card-detail-heading"
        mix={[
          ref((node) => {
            dialog = node;
            if (!loaded) {
              loaded = true;
              node.showModal();
              void load().catch((e) => {
                if (!handle.signal.aborted) {
                  error = e.message;
                  handle.update();
                }
              });
            }
          }),
          on("close", () => handle.props.onClose()),
          on("cancel", (event) => {
            event.preventDefault();
            close();
          }),
          on("click", (event) => {
            if (event.target !== dialog) return;
            let r = dialog.getBoundingClientRect();
            if (
              event.clientX < r.left ||
              event.clientX > r.right ||
              event.clientY < r.top ||
              event.clientY > r.bottom
            )
              close();
          }),
          on("keydown", (event) => {
            if (
              !(event.target as HTMLElement).closest("input,textarea,select") &&
              event.key.toLowerCase() === "e" &&
              detail
            ) {
              event.preventDefault();
              edit();
            }
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              dialog
                ?.querySelector<HTMLFormElement>(".card-editor")
                ?.requestSubmit();
            }
          }),
        ]}
      >
        <header class="card-sheet-bar">
          <span class="card-breadcrumb">
            {handle.props.boardName}
            <span>/</span>Card
          </span>
          <div class="card-sheet-tools">
            <button
              class="btn btn-ghost btn-sm"
              type="button"
              mix={on("click", async () => {
                try {
                  await navigator.clipboard.writeText(location.href);
                  copied = true;
                  handle.update();
                } catch {
                  error = "Could not copy. Copy the URL from your address bar.";
                  handle.update();
                }
              })}
            >
              {copied ? "Link copied" : "Copy link"}
            </button>
            <button
              class="icon-btn"
              type="button"
              aria-label="Close card"
              disabled={busy}
              mix={on("click", close)}
            >
              <XIcon />
            </button>
          </div>
        </header>
        {error && (
          <div class="card-sheet-error alert" role="alert">
            {error}
            {!detail && (
              <button
                class="btn btn-ghost"
                mix={on("click", () => {
                  void load().catch((e) => {
                    error = e.message;
                    handle.update();
                  });
                })}
              >
                Try again
              </button>
            )}
          </div>
        )}
        <div class="card-sheet-grid">
          <div class="card-sheet-main">
            {!editing ? (
              <section class="card-story" key="story">
                <div class="card-statusline">
                  <span class={done ? "status-badge is-done" : "status-badge"}>
                    {done
                      ? "Completed"
                      : (handle.props.columns.find(
                          (c) =>
                            c.id ===
                            (detail?.column_id ??
                              handle.props.preview?.columnId),
                        )?.name ?? "Card")}
                  </span>
                  {detail && (
                    <button
                      class="btn btn-ghost btn-sm"
                      type="button"
                      mix={on("click", edit)}
                    >
                      Edit <kbd>E</kbd>
                    </button>
                  )}
                </div>
                <h2 id="card-detail-heading" class="card-sheet-title">
                  {detail?.title ??
                    handle.props.preview?.title ??
                    "Opening card…"}
                </h2>
                {detail ? (
                  detail.description ? (
                    <p class="card-prose">{detail.description}</p>
                  ) : (
                    <button
                      class="card-empty-description"
                      type="button"
                      mix={on("click", edit)}
                    >
                      Add a description…
                    </button>
                  )
                ) : (
                  <p class="muted" role="status">
                    Loading card details…
                  </p>
                )}
              </section>
            ) : (
              <form
                key="editor"
                class="card-editor detail-form"
                mix={on("submit", async (event) => {
                  event.preventDefault();
                  let form = new FormData(event.currentTarget);
                  if (
                    await change(routes.dashboard.cards.update.href(params()), {
                      title: form.get("title"),
                      description: form.get("description"),
                    })
                  ) {
                    editing = false;
                    handle.update();
                  }
                })}
              >
                <label>
                  Title
                  <input
                    class="field card-title-input"
                    name="title"
                    defaultValue={detail?.title}
                    required
                    maxLength={limits.cardTitle}
                    mix={ref((node) => node.focus())}
                  />
                </label>
                <label>
                  Description
                  <textarea
                    class="field"
                    name="description"
                    defaultValue={detail?.description}
                    maxLength={20000}
                    rows={6}
                    placeholder="What needs to happen?"
                  />
                </label>
                <div class="card-editor-actions">
                  <button class="btn btn-primary" disabled={busy}>
                    Save changes
                  </button>
                  <button
                    class="btn btn-ghost"
                    type="button"
                    disabled={busy}
                    mix={on("click", () => {
                      editing = false;
                      handle.update();
                    })}
                  >
                    Cancel
                  </button>
                  <span class="muted">⌘ / Ctrl ↵ to save</span>
                </div>
              </form>
            )}
            {detail && (
              <>
                <section class="card-section" aria-label="Steps" key="steps">
                  <h3>
                    Steps{" "}
                    <span>
                      {detail.steps.filter((s) => s.completed).length} /{" "}
                      {detail.steps.length}
                    </span>
                  </h3>
                  {!!detail.steps.length && (
                    <progress
                      class="step-progress"
                      max={detail.steps.length}
                      value={detail.steps.filter((s) => s.completed).length}
                      aria-label="Steps completed"
                    />
                  )}
                  <ul class="step-list">
                    {detail.steps.map((step) => (
                      <li key={step.id}>
                        <label class="check-label">
                          <input
                            type="checkbox"
                            checked={Boolean(step.completed)}
                            disabled={busy}
                            mix={on("change", (event) => {
                              void change(routes.dashboard.cards.updateStep.href({ ...params(), stepId: step.id }), {
                                completed: event.currentTarget.checked,
                              });
                            })}
                          />
                          <span class={step.completed ? "step-complete" : ""}>
                            {step.title}
                          </span>
                        </label>
                        <button
                          type="button"
                          class="icon-btn subtle-delete"
                          aria-label={`Delete step ${step.title}`}
                          disabled={busy}
                          mix={on("click", () => {
                            void change(routes.dashboard.cards.removeStep.href({ ...params(), stepId: step.id }));
                          })}
                        >
                          <XIcon />
                        </button>
                      </li>
                    ))}
                  </ul>
                  <form
                    class="inline-compose"
                    mix={on("submit", async (event) => {
                      event.preventDefault();
                      let form = event.currentTarget;
                      if (
                        await change(routes.dashboard.cards.addStep.href(params()), {
                          title: new FormData(form).get("title"),
                        })
                      )
                        form.reset();
                    })}
                  >
                    <input
                      class="field"
                      name="title"
                      aria-label="New step"
                      placeholder="Add a step…"
                      required
                      maxLength={300}
                      disabled={busy}
                    />
                    <button class="btn btn-ghost" disabled={busy}>
                      Add
                    </button>
                  </form>
                </section>
                <section
                  class="card-section"
                  aria-label="Attachments"
                  key="files"
                >
                  <h3>
                    Attachments <span>{detail.files?.length ?? 0}</span>
                  </h3>
                  <ul class="card-file-list">
                    {(detail.files ?? []).map((file) => (
                      <li key={file.id}>
                        <a
                          href={routes.dashboard.boards.file.href({ boardId: handle.props.boardId, fileId: file.id })}
                          download
                        >
                          <PaperclipIcon />
                          <span>{file.name}</span>
                          <small>{Math.ceil(file.size / 1024)} KB</small>
                        </a>
                        <button
                          class="icon-btn subtle-delete"
                          aria-label={`Remove ${file.name}`}
                          disabled={busy}
                          mix={on("click", () => {
                            void change(routes.dashboard.boards.deleteFile.href({ ...params(), fileId: file.id }));
                          })}
                        >
                          <XIcon />
                        </button>
                      </li>
                    ))}
                  </ul>
                  <label class="attach-label">
                    <PaperclipIcon />
                    Attach a file
                    <input
                      type="file"
                      aria-label="Attach a file"
                      disabled={busy}
                      mix={on("change", async (event) => {
                        let file = event.currentTarget.files?.[0];
                        if (!file) return;
                        if (file.size > limits.fileBytes || file.size < 1) {
                          error = `Choose a file between 1 byte and ${limits.fileLabel}.`;
                          handle.update();
                          return;
                        }
                        busy = true;
                        error = "";
                        handle.update();
                        try {
                          let body = new FormData();
                          body.set("file", file);
                          let response = await fetch(routes.dashboard.cards.uploadFile.href(params()), {
                            method: "POST",
                            headers: { Accept: "application/json" },
                            body,
                          });
                          if (!response.ok)
                            throw Error((await response.json()).error);
                          await load();
                          handle.props.onChange();
                        } catch (e) {
                          error = (e as Error).message;
                        } finally {
                          busy = false;
                          handle.update();
                        }
                      })}
                    />
                  </label>
                </section>
                <section
                  class="card-section"
                  aria-label="Comments"
                  key="comments"
                >
                  <h3>
                    Discussion <span>{detail.comments.length}</span>
                  </h3>
                  <div class="comment-list">
                    {[...detail.comments].reverse().map((comment) => (
                      <article key={comment.id} class="card-comment">
                        <span class="comment-avatar" aria-hidden="true">
                          {comment.author.slice(0, 1).toUpperCase()}
                        </span>
                        <div>
                          <div class="comment-meta">
                            <strong>{comment.author}</strong>
                            <time>
                              {new Date(comment.created_at).toLocaleDateString(
                                undefined,
                                { month: "short", day: "numeric" },
                              )}
                            </time>
                            <button
                              class="icon-btn subtle-delete"
                              type="button"
                              aria-label="Delete comment"
                              disabled={busy}
                              mix={on("click", () => {
                                void change(routes.dashboard.cards.removeComment.href({ ...params(), commentId: comment.id }),
                                );
                              })}
                            >
                              <XIcon />
                            </button>
                          </div>
                          <p>{comment.body}</p>
                        </div>
                      </article>
                    ))}
                  </div>
                  <form
                    class="comment-compose"
                    mix={on("submit", async (event) => {
                      event.preventDefault();
                      let form = event.currentTarget;
                      if (
                        await change(routes.dashboard.cards.addComment.href(params()), {
                          body: new FormData(form).get("body"),
                        })
                      )
                        form.reset();
                    })}
                  >
                    <textarea
                      class="field"
                      name="body"
                      aria-label="Comment"
                      placeholder="Write a comment…"
                      rows={3}
                      required
                      maxLength={10000}
                      disabled={busy}
                    />
                    <button class="btn btn-primary btn-sm" disabled={busy}>
                      Post comment
                    </button>
                  </form>
                </section>
              </>
            )}
          </div>
          {detail && (
            <aside class="card-sheet-aside" key="properties">
              <button
                class={
                  done
                    ? "btn complete-button is-done"
                    : "btn btn-primary complete-button"
                }
                type="button"
                disabled={busy || handle.props.columns.length < 2}
                mix={on("click", () => {
                  void change(routes.dashboard.cards.update.href(params()), {
                    columnId: done
                      ? (handle.props.columns.find(column => column.name.toLowerCase() !== 'not now') ?? handle.props.columns[0]).id
                      : doneColumn?.id,
                  });
                })}
              >
                <CheckIcon />
                {done ? "Reopen card" : "Mark as done"}
              </button>
              <label class="card-property">
                Column
                <select
                  class="field"
                  aria-label="Card column"
                  disabled={busy}
                  mix={on("change", (event) => {
                    void change(routes.dashboard.cards.update.href(params()), {
                      columnId: event.currentTarget.value,
                    });
                  })}
                >
                  {handle.props.columns.map((col) => (
                    <option
                      key={col.id}
                      value={col.id}
                      selected={detail?.column_id === col.id}
                    >
                      {col.name}
                    </option>
                  ))}
                </select>
              </label>
              <label class="card-property">
                Priority
                <select
                  class="field"
                  aria-label="Card priority"
                  disabled={busy}
                  mix={on("change", (event) => {
                    void change(routes.dashboard.cards.update.href(params()), {
                      priority: event.currentTarget.value,
                    });
                  })}
                >
                  {["normal", "high", "urgent"].map((p) => (
                    <option key={p} value={p} selected={detail?.priority === p}>
                      {p[0].toUpperCase() + p.slice(1)}
                    </option>
                  ))}
                </select>
              </label>
              <div class="card-property">
                Tags
                <div class="card-tag-list">
                  {detail.tags.map((tag) => (
                    <button
                      key={tag}
                      class="card-tag"
                      type="button"
                      aria-label={`Remove tag ${tag}`}
                      disabled={busy}
                      mix={on("click", () => {
                        void change(routes.dashboard.cards.update.href(params()), {
                          tags: detail!.tags.filter((t) => t !== tag),
                        });
                      })}
                    >
                      {tag}
                      <span>×</span>
                    </button>
                  ))}
                </div>
                <form
                  mix={on("submit", async (event) => {
                    event.preventDefault();
                    let form = event.currentTarget;
                    let tag = String(new FormData(form).get("tag"))
                      .trim()
                      .replace(/^#/, "");
                    if (
                      tag &&
                      (await change(routes.dashboard.cards.update.href(params()), {
                        tags: [...detail!.tags, tag],
                      }))
                    )
                      form.reset();
                  })}
                >
                  <input
                    class="field tag-input"
                    name="tag"
                    aria-label="Add tag"
                    placeholder="+ Add a tag"
                    maxLength={30}
                    disabled={busy}
                  />
                </form>
              </div>
              <button
                class="btn btn-ghost pin-button"
                type="button"
                aria-pressed={Boolean(detail.pinned)}
                disabled={busy}
                mix={on("click", () => {
                  void change(routes.dashboard.cards.update.href(params()), { pinned: !detail!.pinned });
                })}
              >
                {detail.pinned ? "★ Pinned" : "☆ Pin card"}
              </button>
              <label class="card-property">
                Snooze until
                <input
                  class="field"
                  type="date"
                  aria-label="Snooze until"
                  value={detail.snoozed_until ? date(detail.snoozed_until) : ""}
                  disabled={busy}
                  mix={on("change", (event) => {
                    void change(routes.dashboard.cards.update.href(params()), {
                      snoozedUntil: event.currentTarget.value
                        ? new Date(
                            event.currentTarget.value + "T00:00:00",
                          ).getTime()
                        : 0,
                    });
                  })}
                />
              </label>
              <p class="card-created">
                Created{" "}
                {new Date(detail.created_at).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </p>
              <p class="card-save-status" role="status">
                {busy ? "Saving…" : "All changes saved"}
              </p>
            </aside>
          )}
        </div>
      </dialog>
    );
  };
}
