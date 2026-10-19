import { queryOptions, skipToken } from "@tanstack/react-query";
import type { Book } from "./books";
import { toBook } from "./books";
import type { AuthorId, SeriesId } from "./core";
import { failure, ok, send } from "./core";
import {
  getAuthorById,
  getAuthorReading,
  getAuthors,
  getDeleteAuthorUrl,
  getPutAuthorPhotoUrl,
  getPutAuthorPhotoUrlUrl,
  getSeriesById,
  listSeries,
  postAuthorPhotoScan,
} from "./generated/omnibus";
import type {
  AuthorReading as AuthorReadingWire,
  AuthorSummary as AuthorSummaryWire,
  BookReading as BookReadingWire,
  ProgressFormat,
  SeriesSummary as SeriesSummaryWire,
} from "./generated/schemas";

/** The screen's shape of one `GET /api/authors` entry. */
export function toAuthorSummary(wire: AuthorSummaryWire) {
  return {
    id: wire.id as AuthorId,
    name: wire.name,
    sort: wire.sort ?? null,
    bookCount: wire.book_count,
    accent: wire.accent ?? null,
    hasPhoto: wire.has_photo ?? false,
  };
}

export type AuthorSummary = ReturnType<typeof toAuthorSummary>;

/** Every author with a book in the library. */
export async function fetchAuthors(): Promise<AuthorSummary[]> {
  return ok(await getAuthors()).map(toAuthorSummary);
}

export const authorsQuery = queryOptions({
  queryKey: ["authors"],
  queryFn: fetchAuthors,
});

export function toAuthorReading(wire: AuthorReadingWire) {
  return {
    authorId: wire.author_id as AuthorId,
    finished: wire.finished,
    reading: wire.reading,
    lastReadAt: wire.last_read_at ?? null,
  };
}

/** The reader's own progress through one author's books. */
export type AuthorReading = ReturnType<typeof toAuthorReading>;

/** The reader's progress through each author they have started. */
export async function fetchAuthorReading(): Promise<AuthorReading[]> {
  return ok(await getAuthorReading()).map(toAuthorReading);
}

export const authorReadingQuery = queryOptions({
  queryKey: ["authors", "reading"],
  queryFn: fetchAuthorReading,
});

/** The reader's state on one book: where they are and when they last read it. */
export type BookState = {
  status: "unread" | "reading" | "finished";
  percent: number | null;
  lastReadAt: number | null;
  format: ProgressFormat | null;
  fileId: number | null;
};

function toBookState(wire: BookReadingWire): BookState {
  return {
    status: wire.status,
    percent: wire.percent ?? null,
    lastReadAt: wire.last_read_at ?? null,
    format: wire.format ?? null,
    fileId: wire.book_file_id ?? null,
  };
}

/** A book on an author's page: the listing shape, plus the date its caption's year comes from. */
export type CreditedBook = Book & { published: string | null };

export type AuthorPage = {
  id: AuthorId;
  name: string;
  hasPhoto: boolean;
  bookCount: number;
  books: CreditedBook[];
  /** The reader's state on each book they have opened or marked, by book uuid. */
  reading: Map<string, BookState>;
};

/** One author, their books and the reader's state on each; `null` when no author has that id. */
export async function fetchAuthor(id: AuthorId): Promise<AuthorPage | null> {
  const res = await getAuthorById(id);
  if (res.status === 404) return null;
  const data = ok(res);
  return {
    id,
    name: data.name,
    hasPhoto: data.has_photo ?? false,
    bookCount: data.book_count,
    books: data.books.map(toBook),
    reading: new Map(
      (data.reading ?? []).map((r) => [r.book_uuid, toBookState(r)]),
    ),
  };
}

export const authorQuery = (id: AuthorId | null) =>
  queryOptions({
    queryKey: ["author", id],
    queryFn: id === null ? skipToken : () => fetchAuthor(id),
  });

/** The books an author's page credits them with, or `null` when no author has that id. */
export const authorBooksQuery = (id: AuthorId | null) =>
  queryOptions({
    ...authorQuery(id),
    select: (page) => (page === null ? null : page.books),
  });

export const authorPhotoUrl = (id: AuthorId) => `/api/authors/${id}/photo`;

/** Removes the author and un-links their books; the books stay. Admins only. */
export async function deleteAuthor(id: AuthorId): Promise<void> {
  await send(getDeleteAuthorUrl(id), "DELETE");
}

/** Fetches the photo at `url` and keeps it as the author's. Admins only. */
export async function putAuthorPhotoUrl(
  id: AuthorId,
  url: string,
): Promise<void> {
  await send(getPutAuthorPhotoUrlUrl(id), "PUT", { url });
}

/** Keeps the uploaded image as the author's photo. Admins only. */
export async function uploadAuthorPhoto(
  id: AuthorId,
  file: File,
): Promise<void> {
  const form = new FormData();
  form.append("photo", file);
  // Multipart sets its own Content-Type, so this skips `send`.
  const res = await fetch(getPutAuthorPhotoUrl(id), {
    method: "PUT",
    body: form,
  });
  if (!res.ok) throw failure({ status: res.status, data: await res.text() });
}

/** Asks Open Library again for the author's photo; whether one was found. Admins only. */
export async function scanAuthorPhoto(id: AuthorId): Promise<boolean> {
  return ok(await postAuthorPhotoScan(id)).resolved;
}

function toSeriesSummary(wire: SeriesSummaryWire) {
  return {
    id: wire.id as SeriesId,
    name: wire.name,
    sort: wire.sort ?? null,
    bookCount: wire.book_count,
    accent: wire.accent ?? null,
    primaryAuthor: wire.primary_author ?? null,
  };
}

export type SeriesSummary = ReturnType<typeof toSeriesSummary>;

/** Every series in the library. */
export async function fetchSeriesList(): Promise<SeriesSummary[]> {
  return ok(await listSeries()).map(toSeriesSummary);
}

export const seriesListQuery = queryOptions({
  queryKey: ["series"],
  queryFn: fetchSeriesList,
});

/** A series' name, how many of its books the library holds, and those books in reading order. */
export async function fetchSeries(id: SeriesId) {
  const data = ok(await getSeriesById(id));
  return {
    id,
    name: data.name,
    bookCount: data.book_count,
    books: data.books.map((b) => ({
      ...toBook(b),
      description: b.description ?? null,
    })),
  };
}

export const seriesQuery = (id: SeriesId | null) =>
  queryOptions({
    queryKey: ["series", id],
    queryFn: id === null ? skipToken : () => fetchSeries(id),
  });
