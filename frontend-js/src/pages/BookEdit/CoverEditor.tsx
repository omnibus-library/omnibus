import { type FormEvent, useState } from "react";
import {
  type BookUuid,
  bustCover,
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

/** A cover the editor sheet is holding until Done writes it: a picked file, or an image's URL. */
export type HeldCover = {
  source: Exclude<StagedSource, { kind: "keep" }>;
  /** What the surfaces show now: the file's object URL, or the image's own URL. */
  preview: string;
};

/** `held` released, and the object URL its file was shown from with it. */
export function releaseHeld(held: HeldCover | null) {
  if (held?.source.kind === "file") URL.revokeObjectURL(held.preview);
}

export type CoverTarget =
  | {
      kind: "held";
      uuid: BookUuid;
      /** The cover waiting for Done, or `null` when the book keeps the one it has. */
      held: HeldCover | null;
      /** A new pick, or `null` to drop it. The owner releases the one it replaces. */
      onHold: (next: HeldCover | null) => void;
      /** The scanned cover was put back at once: the book as the server now reports it. */
      onReverted: (updated: EditableBook) => void;
    }
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
  /** The page holds a write of its own, or another cover surface is mid-write: take no cover write now. */
  disabled?: boolean;
  /** Told when a cover write starts and ends, so the page can keep Save and Revert off meanwhile. */
  onBusy?: (busy: boolean) => void;
};

/** The cover surfaces of an upload under review, whose cover is staged for the add. */
export type StagedCoverProps = Omit<CoverProps, "target"> & {
  target: Extract<CoverTarget, { kind: "staged" }>;
};

/** The placeholder plate and the image the cover surfaces show now, for a live or a staged target. */
export function coverPreview({ book, target }: CoverProps) {
  const plate = {
    title: book.displayTitle,
    authors: book.primaryAuthor ? [book.primaryAuthor.name] : [],
    accent: book.accent,
  };
  if (target.kind === "staged") {
    return { plate, src: target.staged.preview || null };
  }
  const current = book.coverUrl && bustCover(book.coverUrl, target.uuid);
  return { plate, src: (target.held?.preview ?? current) || null };
}

const ACCEPT = "image/jpeg,image/png,image/webp,image/gif";

function stagedHint({ source, preview }: StagedCover) {
  if (source.kind === "file") return "your image · saved with the book";
  if (source.kind === "url") {
    return "from the edition picker · saved with the book";
  }
  return preview ? "extracted from file" : "no cover available";
}

function heldHint({ source }: HeldCover) {
  return source.kind === "file"
    ? "your image · saved when you press Done"
    : "from the web · saved when you press Done";
}

/** What the book's own cover is, when nothing is waiting to replace it. */
const currentHint = (book: CoverProps["book"]) =>
  !book.coverUrl
    ? "no cover available"
    : book.hasCoverOverride
      ? "custom upload"
      : "extracted from file";

/** The cover card: preview, hint and the controls that replace the cover, or put the scanned one back. */
export function CoverEditor(props: CoverProps) {
  const { book, target, disabled = false, onBusy } = props;
  const [reverting, setReverting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [pastedUrl, setPastedUrl] = useState("");
  const { plate, src } = coverPreview(props);
  const locked = reverting || disabled;

  // The one write the card makes at once: it puts the scanned cover back, and the status line says how that ended.
  async function revert(
    uuid: BookUuid,
    onReverted: (book: EditableBook) => void,
  ) {
    setReverting(true);
    onBusy?.(true);
    setStatus("Reverting…");
    try {
      onReverted(await revertCover(uuid));
      setStatus("Reverted to scanned cover.");
    } catch (e) {
      setStatus(`Revert failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setReverting(false);
      onBusy?.(false);
    }
  }

  const pickFile = (file: File | undefined) => {
    if (!file) return;
    if (target.kind === "held") {
      releaseHeld(target.held);
      target.onHold({
        source: { kind: "file", file },
        preview: URL.createObjectURL(file),
      });
      setStatus("Cover held until Done.");
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

  const applyUrl = (e: FormEvent) => {
    e.preventDefault();
    const url = pastedUrl.trim();
    if (target.kind !== "held" || locked || !url) return;
    releaseHeld(target.held);
    target.onHold({ source: { kind: "url", url }, preview: url });
    setPastedUrl("");
    setStatus("Cover held until Done.");
  };

  return (
    <div className="card me-sidebar-card">
      <div className="me-sidebar-head">
        <div className="label">Cover</div>
      </div>
      <div className="me-cover-preview" data-testid="cover-staged-preview">
        <Cover book={plate} src={src} />
      </div>
      <div className="mono me-cover-hint" data-testid="cover-hint">
        {target.kind === "staged"
          ? stagedHint(target.staged)
          : target.held
            ? heldHint(target.held)
            : currentHint(book)}
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
          disabled={locked}
          onChange={(e) => {
            pickFile(e.target.files?.[0]);
            // So picking the same file again still counts as a change.
            e.target.value = "";
          }}
        />
        {target.kind === "held" ? (
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
                disabled={locked}
                value={pastedUrl}
                onChange={(e) => setPastedUrl(e.target.value)}
              />
              <Button
                type="submit"
                size="sm"
                data-testid="cover-url-apply"
                disabled={locked || !pastedUrl.trim()}
              >
                Apply
              </Button>
            </form>
            {target.held ? (
              <Button
                variant="ghost"
                size="sm"
                style={{
                  marginTop: 8,
                  width: "100%",
                  justifyContent: "center",
                }}
                data-testid="cover-drop-held"
                onClick={() => {
                  releaseHeld(target.held);
                  target.onHold(null);
                  setStatus("Keeping the current cover.");
                }}
              >
                Drop the new cover
              </Button>
            ) : (
              book.hasCoverOverride && (
                <Button
                  variant="ghost"
                  size="sm"
                  style={{
                    marginTop: 8,
                    width: "100%",
                    justifyContent: "center",
                  }}
                  data-testid="cover-remove-override"
                  disabled={locked}
                  onClick={() => revert(target.uuid, target.onReverted)}
                >
                  Revert to scanned cover
                </Button>
              )
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
          {reverting && <Ring size="xs" className="me-cover-ring" />}
          {status}
        </p>
      )}
    </div>
  );
}
