import type { ReactNode } from "react";
import { Link } from "react-router";
import type { BookDetail, BookUuid } from "../../api";
import { BookGlyph, HeadphonesGlyph } from "../Glyphs/Glyphs";
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

function Actions({
  kind,
  uuid,
  fileId,
}: {
  kind: Kind["kind"];
  uuid: BookUuid;
  fileId?: number;
}) {
  const query = fileId === undefined ? "" : `?file_id=${fileId}`;
  switch (kind) {
    case "epub":
      return (
        <Link
          className="btn"
          to={`/read/${uuid}${query}`}
          data-testid="action-read"
        >
          Read
        </Link>
      );
    case "pdf":
      return (
        <Link
          className="btn"
          to={`/pdf/${uuid}${query}`}
          data-testid="action-read-pdf"
        >
          Read
        </Link>
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

type RowProps = { row: Kind; uuid: BookUuid; files: BookFile[] };

function FormatRow({ row, uuid, files }: RowProps) {
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
        {!multi && (
          <div className="format-actions">
            <Actions kind={row.kind} uuid={uuid} />
          </div>
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
              <Actions kind={row.kind} uuid={uuid} fileId={file.id} />
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
};

/** One row per format the book has, each with its read or listen action; a format with several files lists them beneath. */
export function FormatSwitcher({ uuid, formats, files }: FormatSwitcherProps) {
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
        />
      ))}
    </div>
  );
}
