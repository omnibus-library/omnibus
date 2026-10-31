/** An Amazon search on the ISBN, or on title and first author when the book has none. */
export function findCopyUrl(book: {
  isbn13?: string | null;
  title: string;
  authors: readonly string[];
}) {
  const query = book.isbn13?.trim() || `${book.title} ${book.authors[0] ?? ""}`;
  return `https://www.amazon.com/s?k=${encodeURIComponent(query.trim())}`;
}
