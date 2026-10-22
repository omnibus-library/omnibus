import type { BookDetail } from "../../api";
import { Button, ButtonLink } from "../../components/Button/Button";
import { FormatSwitcher } from "../../components/FormatSwitcher/FormatSwitcher";
import { formatDateShort, formatInstantShort } from "../../format";
import { useCurrentUser } from "../../session";
import type { BookDialog } from "./BookDialogs";
import { ExportMenu } from "./ExportMenu";
import { identifierRows } from "./identifiers";
import { PhysicalCopies, WishlistRow } from "./PhysicalCopies";
import { SyncLine } from "./SyncLine";

/** Merge and delete, for admins; each opens the page's dialog. */
function AdminActions({
  book,
  onOpenDialog,
}: {
  book: BookDetail;
  onOpenDialog: (dialog: BookDialog) => void;
}) {
  const viewer = useCurrentUser();
  if (!viewer.isAdmin) return null;
  // Merging folds this record's files into another book, so a record with none can't be offered it.
  const hasFiles = book.formats.length > 0;
  return (
    <>
      {hasFiles && (
        <Button
          variant="ghost"
          size="sm"
          className="bd-rail-edit"
          data-testid="merge-with"
          onClick={() => onOpenDialog("merge")}
        >
          Merge with…
        </Button>
      )}
      {/* Delete stays on a fileless record: its dialog is that record's only removal. */}
      <Button
        variant="ghost"
        size="sm"
        className="bd-rail-edit bd-rail-delete"
        data-testid="delete-files"
        onClick={() => onOpenDialog("delete")}
      >
        {hasFiles ? "Delete files…" : "Delete record…"}
      </Button>
    </>
  );
}

/** Formats and copies, the sync line and export, the metadata table, and the edit actions. */
export function FilesDetails({
  book,
  onOpenDialog,
}: {
  book: BookDetail;
  onOpenDialog: (dialog: BookDialog) => void;
}) {
  // A row is absent, not blank. Published is a calendar date and never shifted;
  // Added is an instant and lands on the reader's own day.
  const rows = [
    { key: "title", label: "Title", value: book.title },
    { key: "author", label: "Author", value: book.authors.join(", ") },
    { key: "publisher", label: "Publisher", value: book.publisher },
    {
      key: "published",
      label: "Published",
      value: book.published && formatDateShort(book.published),
    },
    { key: "language", label: "Language", value: book.language },
    ...identifierRows(book),
    {
      key: "added",
      label: "Added",
      value: book.addedAt && formatInstantShort(book.addedAt),
    },
  ].flatMap(({ value, ...row }) => (value ? [{ ...row, value }] : []));
  return (
    <>
      <div className="bdmq-k">Formats and copies</div>
      <div className="bdmq-copies rx-copies">
        <FormatSwitcher
          uuid={book.uuid}
          formats={book.formats}
          files={book.bookFiles}
          epubSizeBytes={book.epubSizeBytes}
        />
        <PhysicalCopies book={book} />
        <WishlistRow book={book} />
      </div>
      {/* Every item sends or downloads a file; a comic-only or fileless record has none to offer. */}
      {(book.hasEbook || book.hasAudio || book.hasPdf) && (
        <ExportMenu book={book} />
      )}
      {book.hasEbook && book.hasAudio && <SyncLine uuid={book.uuid} />}
      <div className="divider bdmq-files-div" />
      <table className="rx-kv bd-meta-table mono">
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="bd-meta-row">
              <td className="bd-meta-k">{row.label}</td>
              <td className="bd-meta-v">{row.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="bdmq-files-actions">
        <ButtonLink
          variant="ghost"
          size="sm"
          to={`/books/${book.uuid}/edit`}
          data-testid="edit-metadata"
        >
          Edit metadata…
        </ButtonLink>
        <AdminActions book={book} onOpenDialog={onOpenDialog} />
      </div>
    </>
  );
}
