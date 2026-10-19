import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  type BookUuid,
  createJournalEntry,
  deleteJournalEntry,
  previewJournal,
  updateJournalEntry,
} from "../../api";
import { Button } from "../../components/Button/Button";
import { BusyLabel } from "../../components/Loading/Loading";
import {
  type EditorHandle,
  JournalEditor,
  JournalToolbar,
} from "./JournalEditor";
import { highlightBlockquote } from "./journalMarkdown";
import { highlightsQuery, journalQuery } from "./queries";

const AUTOSAVE_DEBOUNCE_MS = 2_000;
const AUTOSAVE_TICK_MS = 5_000;
const PLACEHOLDER =
  "What are you thinking about this book? Markdown supported.";

function HighlightsPopover({
  uuid,
  onPick,
}: {
  uuid: BookUuid;
  onPick: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  // Fetched on first open; the cache keeps it for every later one.
  const highlights = useQuery({ ...highlightsQuery(uuid), enabled: open });
  const quotable = (highlights.data ?? []).flatMap(({ id, text }) =>
    text ? [{ id, text }] : [],
  );
  return (
    <div className="bd-journal-hl-wrap">
      <Button
        variant="ghost"
        size="sm"
        className={open ? "bd-tab-active" : undefined}
        data-testid="journal-insert-highlight"
        onClick={() => setOpen(!open)}
      >
        From highlights
      </Button>
      {open && (
        <div
          className="card bd-journal-hl-pop"
          data-testid="journal-highlights-pop"
        >
          <div className="label bd-journal-hl-head">From your highlights</div>
          {quotable.length === 0 ? (
            <p className="mono bd-journal-hl-empty">
              No saved highlights for this book yet.
            </p>
          ) : (
            quotable.map(({ id, text }) => (
              <button
                key={id}
                type="button"
                className="bd-journal-hl-item"
                data-testid="journal-highlight-item"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onPick(text);
                  setOpen(false);
                }}
              >
                {text}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/** The new-entry form: Write/Preview, an autosaved draft, and Save draft / Publish. */
export function JournalComposer({
  uuid,
  onClose,
}: {
  uuid: BookUuid;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const editor = useRef<EditorHandle>(null);
  const [body, setBody] = useState("");
  const [preview, setPreview] = useState(false);
  const [trackProgress, setTrackProgress] = useState(false);
  const [progress, setProgress] = useState(50);
  const [error, setError] = useState<string | null>(null);
  const [autosavedSecs, setAutosavedSecs] = useState<number | null>(null);

  // One draft row rides the whole session; writes queue so a slow create can't be repeated.
  const draft = useRef<{ id: number | null; queue: Promise<unknown> }>({
    id: null,
    queue: Promise.resolve(),
  });
  const persist = (status?: "draft" | "published") => {
    const input = { bodyMd: body, progress: trackProgress ? progress : null };
    const write = async () => {
      const entry =
        draft.current.id === null
          ? await createJournalEntry(uuid, {
              ...input,
              status: status ?? "draft",
            })
          : await updateJournalEntry(draft.current.id, { ...input, status });
      draft.current.id = entry.id;
    };
    const done = draft.current.queue.then(write);
    draft.current.queue = done.catch(() => undefined);
    return done;
  };

  const save = useMutation({
    mutationFn: persist,
    onMutate: () => setError(null),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: journalQuery(uuid).queryKey });
      onClose();
    },
    onError: (e) => setError(e.message),
  });
  const discard = useMutation({
    mutationFn: async () => {
      await draft.current.queue;
      if (draft.current.id !== null) await deleteJournalEntry(draft.current.id);
    },
    // Best effort: a draft that lingers is the author's own and harmless.
    onSettled: onClose,
  });
  // A failed autosave stays quiet; the next keystroke tries again.
  const autosave = useMutation({
    mutationFn: () => persist(),
    onSuccess: () => setAutosavedSecs(0),
  });
  const rendering = useMutation({
    mutationFn: previewJournal,
    onSuccess: () => setError(null),
    onError: (e) => setError(`Preview failed: ${e.message}`),
  });

  const busy = save.isPending || discard.isPending;
  const { mutate: autosaveNow } = autosave;
  useEffect(() => {
    if (!body.trim() || busy) return;
    const timer = setTimeout(autosaveNow, AUTOSAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [body, busy, autosaveNow]);

  const saved = autosavedSecs !== null;
  useEffect(() => {
    if (!saved) return;
    const tick = setInterval(
      () =>
        setAutosavedSecs((s) => (s === null ? s : s + AUTOSAVE_TICK_MS / 1000)),
      AUTOSAVE_TICK_MS,
    );
    return () => clearInterval(tick);
  }, [saved]);

  const cannotSave = busy || !body.trim();
  return (
    <div className="card bd-journal-composer" data-testid="journal-composer">
      <div className="bd-journal-composer-tabs">
        <Button
          variant="ghost"
          size="sm"
          className={preview ? undefined : "bd-tab-active"}
          onClick={() => setPreview(false)}
        >
          Write
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className={preview ? "bd-tab-active" : undefined}
          data-testid="journal-preview-toggle"
          onClick={() => {
            setPreview(true);
            rendering.reset();
            rendering.mutate(body);
          }}
        >
          Preview
        </Button>
        <span className="bd-journal-foot-spacer" />
        <span
          className="mono bd-journal-spoiler-help"
          data-testid="journal-spoiler-help"
          title="Hide spoilers with ||double pipes|| — they appear blurred until clicked."
        >
          Spoilers? Wrap text in ||double pipes||
        </span>
      </div>
      {preview ? (
        <div
          className="bd-journal-preview"
          data-testid="journal-preview"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: the server renders and sanitises the preview, as it does a saved entry
          dangerouslySetInnerHTML={{ __html: rendering.data ?? "" }}
        />
      ) : (
        <>
          <div className="bd-journal-toolbar-row">
            <JournalToolbar editor={editor} onError={setError} />
            <HighlightsPopover
              uuid={uuid}
              onPick={(text) =>
                editor.current?.apply({
                  op: "insert",
                  text: highlightBlockquote(text),
                })
              }
            />
          </div>
          <JournalEditor
            ref={editor}
            initial={body}
            onChange={setBody}
            label="Journal entry"
            testId="journal-editor"
            placeholder={PLACEHOLDER}
          />
        </>
      )}
      <div className="bd-journal-composer-foot">
        <label className="bd-journal-progress">
          <input
            type="checkbox"
            checked={trackProgress}
            onChange={(event) => setTrackProgress(event.target.checked)}
          />
          <span className="label">Progress</span>
          {trackProgress && (
            <div className="bd-journal-progress-slider">
              <input
                type="range"
                className="bd-journal-progress-range"
                min={0}
                max={100}
                value={progress}
                aria-label="Reading progress"
                // Chrome and Safari drop the native fill under `appearance: none`.
                style={{
                  background: `linear-gradient(to right, var(--accent) 0%, var(--accent) ${progress}%, var(--bg-3) ${progress}%, var(--bg-3) 100%)`,
                }}
                data-testid="journal-progress"
                onChange={(event) => setProgress(event.target.valueAsNumber)}
              />
              <span className="mono bd-journal-progress-val">{progress}%</span>
            </div>
          )}
        </label>
        <span className="bd-journal-foot-spacer" />
        {autosavedSecs !== null && (
          <span
            className="mono bd-journal-autosaved"
            data-testid="journal-autosaved"
          >
            {autosavedSecs === 0
              ? "Auto-saved just now"
              : `Auto-saved ${autosavedSecs}s ago`}
          </span>
        )}
        {error && (
          <span className="mono bd-journal-error" role="alert">
            {error}
          </span>
        )}
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => discard.mutate()}
        >
          Cancel
        </Button>
        <Button
          variant="ghost"
          size="sm"
          data-testid="journal-save-draft"
          disabled={cannotSave}
          aria-busy={save.isPending && save.variables === "draft"}
          onClick={() => save.mutate("draft")}
        >
          <BusyLabel
            busy={save.isPending && save.variables === "draft"}
            label="Save draft"
            busyLabel="Saving…"
          />
        </Button>
        <Button
          variant="primary"
          size="sm"
          data-testid="journal-publish"
          disabled={cannotSave}
          aria-busy={save.isPending && save.variables === "published"}
          onClick={() => save.mutate("published")}
        >
          <BusyLabel
            busy={save.isPending && save.variables === "published"}
            label="Publish entry"
            busyLabel="Publishing…"
          />
        </Button>
      </div>
    </div>
  );
}
