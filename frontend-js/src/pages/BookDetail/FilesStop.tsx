import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router";
import { type BookDetail, undoBookMerge } from "../../api";
import { Button, ButtonLink } from "../../components/Button/Button";
import { DeleteBookDialog } from "../../components/DeleteBookDialog/DeleteBookDialog";
import { FormatSwitcher } from "../../components/FormatSwitcher/FormatSwitcher";
import { MergeDialog } from "../../components/MergeDialog/MergeDialog";
import { formatDateShort, formatInstantShort } from "../../format";
import { useCurrentUser } from "../../session";
import { identifierRows } from "./identifiers";
import { PhysicalCopies, WishlistRow } from "./PhysicalCopies";

/** Merge and delete, for admins; each leaves the page refetched, or gone when the book is. */
function AdminActions({ book }: { book: BookDetail }) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const viewer = useCurrentUser();
  const [dialog, setDialog] = useState<"merge" | "delete" | null>(null);
  const [mergeLogId, setMergeLogId] = useState<number | null>(null);
  const refresh = () =>
    client.invalidateQueries({ queryKey: ["book", book.uuid] });
  const undo = useMutation({
    mutationFn: undoBookMerge,
    onSuccess: () => {
      setMergeLogId(null);
      return refresh();
    },
  });
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
          onClick={() => setDialog("merge")}
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
        onClick={() => setDialog("delete")}
      >
        {hasFiles ? "Delete files…" : "Delete record…"}
      </Button>
      {dialog === "merge" && (
        <MergeDialog
          target={book}
          onMerged={(logId) => {
            undo.reset();
            setMergeLogId(logId);
            setDialog(null);
            refresh();
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "delete" && (
        <DeleteBookDialog
          uuid={book.uuid}
          title={book.title}
          onDeleted={(bookDeleted) => {
            setDialog(null);
            if (!bookDeleted) return refresh();
            client.removeQueries({ queryKey: ["book", book.uuid] });
            navigate("/", { replace: true });
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {mergeLogId !== null && (
        <div className="bd-merge-toast card" role="status">
          <span>
            Books merged. Undo is available until you leave this page.
          </span>
          <Button
            variant="ghost"
            size="sm"
            data-testid="merge-undo"
            disabled={undo.isPending}
            onClick={() => undo.mutate(mergeLogId)}
          >
            Undo
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Dismiss"
            data-testid="merge-toast-dismiss"
            onClick={() => setMergeLogId(null)}
          >
            ×
          </Button>
          {undo.isError && (
            <p role="alert" className="bd-merge-error">
              {undo.error.message}
            </p>
          )}
        </div>
      )}
    </>
  );
}

/** Stop 05: formats and copies, the metadata table, and the edit actions. */
export function FilesStop({ book }: { book: BookDetail }) {
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
        <AdminActions book={book} />
      </div>
    </>
  );
}
