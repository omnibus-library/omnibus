import { type Book, thumbSrcSet, thumbUrl } from "../../api";
import { Cover } from "./Cover";

const TILE_SIZES = "(max-width: 640px) 160px, (max-width: 1280px) 200px, 240px";

/** A book's cover from its thumbnails, or the plate when it has none; `sizes` is the width it is drawn at. */
export function CoverImage({
  book,
  sizes = TILE_SIZES,
}: {
  book: Book;
  sizes?: string;
}) {
  return (
    <Cover
      book={book}
      src={book.hasCover ? thumbUrl(book.uuid) : null}
      srcSet={book.hasCover ? thumbSrcSet(book.uuid) : undefined}
      sizes={sizes}
    />
  );
}
