import { type FormEvent, useState } from "react";
import {
  type BookUuid,
  bustCover,
  coverFromUrl,
  type EditableBook,
  revertCover,
  type StagedSource,
  uploadCover,
} from "../../api";
import { Button } from "../../components/Button/Button";
import { Cover } from "../../components/Cover/Cover";
import { BusyLabel, Ring } from "../../components/Loading/Loading";

/** A cover chosen during review, not yet written anywhere. */
export type StagedCover = {
  source: StagedSource;
  /** What the surfaces show now: the file's own preview, an object URL, or the provider's image URL. */
  preview: string | null;
  /** The inspected file's own preview, kept so "use the file's cover" can put it back. */
  originalPreview: string | null;
};

export type CoverTarget =
  | { kind: "live"; uuid: BookUuid }
  | {
      kind: "staged";
      staged: StagedCover;
      onStage: (next: StagedCover) => void;
    };

/** `staged` with a new choice, releasing the object URL of the pick it replaces. */
export function restage(
  staged: StagedCover,
  source: StagedSource,
  preview: string | null,
): StagedCover {
  // The file's own preview is a data: URL and isn't ours to revoke.
  if (staged.preview && staged.preview !== staged.originalPreview) {
    URL.revokeObjectURL(staged.preview);
  }
  return { ...staged, source, preview };
}

/** What the cover surfaces share: the sidebar's editor and the compare screen's cover row. */
export type CoverProps = {
  book: Pick<
    EditableBook,
    | "displayTitle"
    | "primaryAuthor"
    | "accent"
    | "coverUrl"
    | "hasCoverOverride"
  >;
  target: CoverTarget;
  /** A write landed: the book as the server now reports it. */
  onApplied: (updated: EditableBook) => void;
};

/** The placeholder plate and the image the cover surfaces show now, for a live or a staged target. */
export function coverPreview({ book, target }: CoverProps) {
  const plate = {
    title: book.displayTitle,
    authors: book.primaryAuthor ? [book.primaryAuthor.name] : [],
    accent: book.accent,
  };
  const src =
    target.kind === "live"
      ? book.coverUrl && bustCover(book.coverUrl, target.uuid)
      : target.staged.preview;
  return { plate, src: src || null };
}

const ACCEPT = "image/jpeg,image/png,image/webp,image/gif";

function stagedHint({ source, preview }: StagedCover) {
  if (source.kind === "file") return "your image · saved with the book";
  if (source.kind === "url") {
    return "from the edition picker · saved with the book";
  }
  return preview ? "extracted from file" : "no cover available";
}

/** The sidebar's cover card: preview, hint and the controls that replace or revert the cover. */
export function CoverEditor(props: CoverProps) {
  const { book, target, onApplied } = props;
  const [busy, setBusy] = useState<"file" | "url" | "revert" | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [pastedUrl, setPastedUrl] = useState("");
  const { plate, src } = coverPreview(props);

  // One write at a time; the status line says what is in flight and then how it ended.
  async function write(
    kind: NonNullable<typeof busy>,
    working: string,
    done: string,
    failed: string,
    call: () => Promise<EditableBook>,
  ) {
    setBusy(kind);
    setStatus(working);
    try {
      onApplied(await call());
      setStatus(done);
      return true;
    } catch (e) {
      setStatus(`${failed}${e instanceof Error ? e.message : String(e)}`);
      return false;
    } finally {
      setBusy(null);
    }
  }

  const pickFile = (file: File | undefined) => {
    if (!file) return;
    if (target.kind === "live") {
      const { uuid } = target;
      void write(
        "file",
        `Uploading ${file.name}…`,
        "Cover updated.",
        "Upload failed: ",
        () => uploadCover(uuid, file),
      );
    } else {
      target.onStage(
        restage(
          target.staged,
          { kind: "file", file },
          URL.createObjectURL(file),
        ),
      );
      setStatus("Cover staged.");
    }
  };

  const applyUrl = async (e: FormEvent) => {
    e.preventDefault();
    const url = pastedUrl.trim();
    if (target.kind !== "live" || busy || !url) return;
    const { uuid } = target;
    const applied = await write(
      "url",
      "Applying cover…",
      "Cover updated.",
      "Couldn't apply that URL: ",
      () => coverFromUrl(uuid, url),
    );
    if (applied) setPastedUrl("");
  };

  return (
    <div className="card me-sidebar-card">
      <div className="me-sidebar-head">
        <div className="label">Cover</div>
      </div>
      <div
        className="me-cover-preview"
        data-testid={
          target.kind === "staged" ? "cover-staged-preview" : undefined
        }
      >
        <Cover book={plate} src={src} />
      </div>
      <div className="mono me-cover-hint" data-testid="cover-hint">
        {target.kind === "staged"
          ? stagedHint(target.staged)
          : !book.coverUrl
            ? "no cover available"
            : book.hasCoverOverride
              ? "custom upload"
              : "extracted from file"}
      </div>
      <div className="me-cover-actions">
        <label className="label" htmlFor="cover-file-input">
          Replace cover
        </label>
        <input
          id="cover-file-input"
          className="me-cover-file"
          type="file"
          accept={ACCEPT}
          data-testid="cover-upload-input"
          disabled={busy !== null}
          onChange={(e) => {
            pickFile(e.target.files?.[0]);
            // So picking the same file again still counts as a change.
            e.target.value = "";
          }}
        />
        {target.kind === "live" ? (
          <>
            <label className="label" htmlFor="cover-url-input">
              Or paste an image URL
            </label>
            <form className="me-cover-url" onSubmit={applyUrl}>
              <input
                id="cover-url-input"
                className="me-input"
                type="url"
                placeholder="https://…"
                data-testid="cover-url-input"
                disabled={busy !== null}
                value={pastedUrl}
                onChange={(e) => setPastedUrl(e.target.value)}
              />
              <Button
                type="submit"
                size="sm"
                data-testid="cover-url-apply"
                disabled={busy !== null || !pastedUrl.trim()}
                aria-busy={busy === "url"}
              >
                <BusyLabel
                  busy={busy === "url"}
                  label="Apply"
                  busyLabel="Applying…"
                />
              </Button>
            </form>
            {book.hasCoverOverride && (
              <Button
                variant="ghost"
                size="sm"
                style={{
                  marginTop: 8,
                  width: "100%",
                  justifyContent: "center",
                }}
                data-testid="cover-remove-override"
                disabled={busy !== null}
                onClick={() =>
                  write(
                    "revert",
                    "Reverting…",
                    "Reverted to scanned cover.",
                    "Revert failed: ",
                    () => revertCover(target.uuid),
                  )
                }
              >
                Revert to scanned cover
              </Button>
            )}
          </>
        ) : (
          target.staged.source.kind !== "keep" && (
            <Button
              variant="ghost"
              size="sm"
              style={{ marginTop: 8, width: "100%", justifyContent: "center" }}
              data-testid="cover-remove-override"
              onClick={() => {
                target.onStage(
                  restage(
                    target.staged,
                    { kind: "keep" },
                    target.staged.originalPreview,
                  ),
                );
                setStatus("Using the file's cover.");
              }}
            >
              Use the file’s cover
            </Button>
          )
        )}
      </div>
      {status && (
        <p
          className="mono me-cover-hint"
          role="status"
          data-testid="cover-upload-status"
        >
          {busy && <Ring size="xs" className="me-cover-ring" />}
          {status}
        </p>
      )}
    </div>
  );
}
