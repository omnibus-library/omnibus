import type { ReactNode } from "react";
import { Link } from "react-router";
import type { BookDetail, BookUuid } from "../../api";
import { BookGlyph, HeadphonesGlyph } from "../Glyphs/Glyphs";
import {
  KINDLE_WEB_UPLOAD_URL,
  kindleOversize,
  SendToKindle,
} from "./SendToKindle";
import "./FormatSwitcher.css";

type BookFile = BookDetail["bookFiles"][number];

type Kind = {
  label: string;
  name: string;
  kind: "epub" | "pdf" | "audio" | "other";
};

// M4A shares M4B's container and player, so it is one row with it.
function kindOf(raw: string): Kind {
  switch (raw.toUpperCase()) {
    case "EPUB":
      return { label: "EPUB", name: "Ebook", kind: "epub" };
    case "PDF":
      return { label: "PDF", name: "PDF", kind: "pdf" };
    case "M4B":
    case "M4A":
      return { label: "M4B", name: "Audiobook", kind: "audio" };
    case "MP3":
      return { label: "MP3", name: "Audiobook", kind: "audio" };
    default:
      return { label: raw, name: raw, kind: "other" };
  }
}

// One row per format, alphabetical without regard to case.
function rowKinds(formats: readonly string[]): Kind[] {
  const rows = formats
    .map(kindOf)
    .sort((a, b) =>
      a.label.localeCompare(b.label, "en", { sensitivity: "base" }),
    );
  return rows.filter(
    (row, i) =>
      i === 0 || rows[i - 1]?.label.toLowerCase() !== row.label.toLowerCase(),
  );
}

function humanSize(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** The Kindle action: email it, or past the email cap a link to Amazon's own uploader. */
function KindleAction({
  uuid,
  file,
  bytes,
}: {
  uuid: BookUuid;
  file?: BookFile;
  bytes: number;
}) {
  return kindleOversize(bytes) ? (
    <a
      className="btn"
      href={KINDLE_WEB_UPLOAD_URL}
      target="_blank"
      rel="noopener noreferrer"
      title="This EPUB is larger than the 50 MB limit for emailing files to a Kindle. Amazon's Send to Kindle page (opens in a new tab) accepts files up to 200 MB."
      data-testid="action-kindle-oversize"
    >
      Send to Kindle…
    </a>
  ) : (
    <SendToKindle uuid={uuid} fileId={file?.id} />
  );
}

/** The KEPUB, for copying onto a Kobo; the server falls back to the plain EPUB when it can't convert. */
export function SendToKobo({
  uuid,
  className = "btn",
  testId = "action-kobo",
}: {
  uuid: BookUuid;
  className?: string;
  testId?: string;
}) {
  return (
    <a
      className={className}
      href={`/api/ebooks/${uuid}/kepub`}
      download=""
      title="Download the KEPUB to copy onto a Kobo"
      data-testid={testId}
    >
      Send to Kobo
    </a>
  );
}

type ActionsProps = {
  kind: Kind["kind"];
  uuid: BookUuid;
  /** The one file of a multi-file row; absent on a row that stands for the whole book. */
  file?: BookFile;
  /** The book's size for the Kindle cap: the row's file, else its first EPUB or PDF. */
  epubSizeBytes: number | null;
};

function Actions({ kind, uuid, file, epubSizeBytes }: ActionsProps) {
  const query = file === undefined ? "" : `?file_id=${file.id}`;
  const bytes = file ? file.sizeBytes : (epubSizeBytes ?? 0);
  switch (kind) {
    case "epub":
      return (
        <>
          <Link
            className="btn"
            to={`/read/${uuid}${query}`}
            data-testid="action-read"
          >
            Read
          </Link>
          <KindleAction uuid={uuid} file={file} bytes={bytes} />
          {file === undefined && <SendToKobo uuid={uuid} />}
        </>
      );
    case "pdf":
      return (
        <>
          <Link
            className="btn"
            to={`/pdf/${uuid}${query}`}
            data-testid="action-read-pdf"
          >
            Read
          </Link>
          <KindleAction uuid={uuid} file={file} bytes={bytes} />
        </>
      );
    case "audio":
      return (
        <Link
          className="btn"
          to={`/listen/${uuid}${query}`}
          data-testid="action-listen"
        >
          Listen
        </Link>
      );
    case "other":
      return <span className="format-actions-empty">No actions yet</span>;
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

function Glyph({ row }: { row: Kind }): ReactNode {
  switch (row.kind) {
    case "epub":
    case "pdf":
      return <BookGlyph size={15} />;
    case "audio":
      return <HeadphonesGlyph size={15} />;
    default:
      return row.label;
  }
}

type RowProps = {
  row: Kind;
  uuid: BookUuid;
  files: BookFile[];
  epubSizeBytes: number | null;
};

function FormatRow({ row, uuid, files, epubSizeBytes }: RowProps) {
  const multi = files.length > 1;
  const first = files[0];
  const sub = multi
    ? `${files.length} editions`
    : first && first.sizeBytes > 0
      ? humanSize(first.sizeBytes)
      : null;
  const title = multi ? `${row.label} (${files.length} files)` : row.label;
  return (
    <>
      <div
        className={
          multi ? "format-row format-row-multi rx-copy" : "format-row rx-copy"
        }
        data-format={row.label}
        data-testid={`format-row-${row.label.toLowerCase()}`}
      >
        <span
          role="img"
          className="format-badge rx-ic"
          data-testid="format-badge"
          title={title}
          aria-label={title}
        >
          <Glyph row={row} />
        </span>
        <div className="rx-copy-body">
          <div className="nm">{row.name}</div>
          {sub && <div className="sb">{sub}</div>}
        </div>
        {/* Kobo's KEPUB is made from the book's primary EPUB, so a multi-file row keeps that one action. */}
        {!multi ? (
          <div className="format-actions">
            <Actions
              kind={row.kind}
              uuid={uuid}
              epubSizeBytes={epubSizeBytes}
            />
          </div>
        ) : (
          row.kind === "epub" && (
            <div className="format-actions">
              <SendToKobo uuid={uuid} />
            </div>
          )
        )}
      </div>
      {multi &&
        files.map((file) => (
          <div
            key={file.id}
            className="format-row format-subrow rx-copy-sub"
            data-testid={`format-file-${file.id}`}
          >
            <span className="format-sublabel">
              {file.label ?? `Part ${file.ordinal + 1}`}
            </span>
            <div className="format-actions">
              <Actions
                kind={row.kind}
                uuid={uuid}
                file={file}
                epubSizeBytes={epubSizeBytes}
              />
            </div>
          </div>
        ))}
    </>
  );
}

type FormatSwitcherProps = {
  uuid: BookUuid;
  formats: readonly string[];
  files: BookFile[];
  /** The size Send to Kindle is gated on. */
  epubSizeBytes: number | null;
};

/** One row per format the book has, each with its read or listen action; a format with several files lists them beneath. */
export function FormatSwitcher({
  uuid,
  formats,
  files,
  epubSizeBytes,
}: FormatSwitcherProps) {
  const rows = rowKinds(formats);
  if (rows.length === 0) return null;
  return (
    // biome-ignore lint/a11y/useSemanticElements: a fieldset brings a border and min-width Atrium never resets
    <div
      className="format-switcher rx-copies"
      role="group"
      aria-label="Available formats"
      data-testid="format-switcher"
    >
      {rows.map((row) => (
        <FormatRow
          key={row.label}
          row={row}
          uuid={uuid}
          files={files.filter((f) => kindOf(f.format).label === row.label)}
          epubSizeBytes={epubSizeBytes}
        />
      ))}
    </div>
  );
}
