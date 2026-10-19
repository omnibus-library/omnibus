import type { BookDetail } from "../../api";
import { ButtonLink } from "../../components/Button/Button";
import { FormatSwitcher } from "../../components/FormatSwitcher/FormatSwitcher";
import { formatDateShort, formatInstantShort } from "../../format";
import { identifierRows } from "./identifiers";

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
        />
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
      </div>
    </>
  );
}
