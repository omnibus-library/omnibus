import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import type { BookDetail, BookUuid } from "../../api";
import { classes } from "../../classes";

export type BookFile = BookDetail["bookFiles"][number];
type Kind = "read" | "listen";

const LABEL = {
  read: "Choose which file to read",
  listen: "Choose which file to listen to",
} satisfies Record<Kind, string>;

const TESTID = {
  read: "read-file-picker",
  listen: "listen-file-picker",
} satisfies Record<Kind, string>;

const isFormat = (file: BookFile, ...names: string[]) =>
  names.includes(file.format.toUpperCase());

/** The files the Read picker offers: EPUBs and PDFs, each opening its own reader. */
export const isReadableFile = (file: BookFile) => isFormat(file, "EPUB", "PDF");

/** The files the Listen picker offers. */
export const isAudioFile = (file: BookFile) =>
  isFormat(file, "M4B", "M4A", "MP3");

// A mixed EPUB+PDF book keeps the EPUB as its reader and reaches the PDF here.
function readerRoute(file: BookFile | undefined): "read" | "pdf" | "comic" {
  if (file && isFormat(file, "PDF")) return "pdf";
  return file && isFormat(file, "CBZ") ? "comic" : "read";
}

function href(
  kind: Kind,
  uuid: BookUuid,
  file: BookFile | undefined,
  byFile: boolean,
): string {
  const route = kind === "listen" ? "listen" : readerRoute(file);
  // The comic pager takes no file id.
  const query =
    byFile && file && route !== "comic" ? `?file_id=${file.id}` : "";
  return `/${route}/${uuid}${query}`;
}

// Decimal units, as the file's own size shows elsewhere.
function fileSize(bytes: number): string | null {
  if (bytes <= 0) return null;
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  return bytes >= 1e3 ? `${(bytes / 1e3).toFixed(1)} KB` : `${bytes} B`;
}

function ItemCopy({ kind, file }: { kind: Kind; file: BookFile }) {
  const label = file.label?.trim() || `Part ${file.ordinal + 1}`;
  const size = fileSize(file.sizeBytes);
  const meta =
    kind === "listen" && file.label?.trim() ? `${file.label} · ${size}` : size;
  return (
    <div className="bd-file-picker-item-copy">
      <div className="bd-file-picker-item-title">
        {kind === "listen" ? "Audiobook" : file.format.toUpperCase()} · {label}
      </div>
      {size && <div className="mono bd-file-picker-item-meta">{meta}</div>}
    </div>
  );
}

type FilePickerProps = {
  uuid: BookUuid;
  kind: Kind;
  files: BookFile[];
  label: string;
  /** The button's look, such as `btn primary lg`. */
  buttonClass: string;
  /** The test id the single-file link carries. */
  singleTestId: string;
};

/** A Read or Listen button that opens a list of files when the book has several. */
export function FilePicker({
  uuid,
  kind,
  files,
  label,
  buttonClass,
  singleTestId,
}: FilePickerProps) {
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    // After paint, or the focus ring never shows; once per opening, not on every render.
    const frame = requestAnimationFrame(() => panel.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);
  if (files.length < 2) {
    return (
      <Link
        className={buttonClass}
        to={href(kind, uuid, files[0], false)}
        data-testid={singleTestId}
      >
        {label}
      </Link>
    );
  }
  const testId = TESTID[kind];
  return (
    <div className="bd-file-picker">
      <button
        type="button"
        className={classes(buttonClass, "bd-file-picker-trigger")}
        data-testid={`${testId}-trigger`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={LABEL[kind]}
        onClick={() => setOpen(!open)}
      >
        {label}
        <span className="bd-file-picker-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <>
          {/* biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: Escape on the dialog is the keyboard's way out; the scrim is the pointer's */}
          <div
            className="bd-export-scrim"
            data-testid={`${testId}-scrim`}
            onClick={() => setOpen(false)}
          />
          <div
            ref={panel}
            className="bd-export-panel bd-file-picker-panel card"
            role="dialog"
            aria-label={LABEL[kind]}
            data-testid={`${testId}-panel`}
            tabIndex={-1}
            onKeyDown={(event) => event.key === "Escape" && setOpen(false)}
          >
            <div
              className="label bd-file-picker-heading"
              data-testid={`${testId}-heading`}
            >
              {files.length} files · choose one
            </div>
            {files.map((file) => (
              <Link
                key={file.id}
                className="bd-export-item bd-file-picker-item"
                to={href(kind, uuid, file, true)}
                data-testid={`${testId}-item-${file.id}`}
                onClick={() => setOpen(false)}
              >
                <ItemCopy kind={kind} file={file} />
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
