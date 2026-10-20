import {
  parseBookUuid,
  type StatsSummary,
  thumbSrcSet,
  thumbUrl,
} from "../../api";
import { Cover } from "../../components/Cover/Cover";
import "../../components/ShelfForm/ShelfForm.css";

export type FinishedBook = StatsSummary["finished_books"][number];

/** A finished book's cover from its thumbnails, or the plate when it has none; `sizes` is the width it is drawn at. */
export function FinishedCover({
  book,
  sizes,
}: {
  book: FinishedBook;
  sizes: string;
}) {
  const uuid = book.cover_url ? parseBookUuid(book.book_uuid) : null;
  return (
    <div className="shelf-cover-tile">
      <Cover
        book={{
          title: book.title,
          authors: book.author ? [book.author] : [],
          accent: null,
        }}
        src={uuid ? thumbUrl(uuid) : null}
        srcSet={uuid ? thumbSrcSet(uuid) : undefined}
        sizes={sizes}
      />
    </div>
  );
}
