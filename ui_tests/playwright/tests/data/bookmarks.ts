import { pdfPageAnchor } from "./progress";

/** The body of `POST /api/bookmarks`. */
export type NewBookmark = {
  book_uuid: string;
  position: string;
  title: string;
};

/** A bookmark the server stored, with the id it was given. */
export type SeededBookmark = NewBookmark & { id: number };

/** The bookmark "+ Bookmark" saves on the 0-based PDF page `index`. */
export function pdfPageBookmark(bookUuid: string, index: number): NewBookmark {
  return {
    book_uuid: bookUuid,
    position: pdfPageAnchor(index),
    title: `Page ${index + 1}`,
  };
}
