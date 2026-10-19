import { z } from "zod";
import {
  getEbookByUuid,
  getEbooks,
  getLogoutUrl,
  getMe,
  getRecentProgress,
  getRegistration,
  getSearchPalette,
  login as postLogin,
  register as postRegister,
} from "./api/generated/omnibus";
import {
  type EbookMetadata,
  type EbookPage,
  type PaletteResults as PaletteWire,
  type ResumePoint as ResumePointWire,
  SortDir,
  SortKey,
  type UserSummary,
} from "./api/generated/schemas";

export { SortDir, SortKey };

// The wire types and their zod schemas are generated from openapi/openapi.json
// (`pnpm run generate`), and the generated fetchers validate every response.
// This file turns the wire shapes into the ones the screens render.

export type BookUuid = string & { readonly __brand: "BookUuid" };

const bookUuid = z
  .string()
  .min(1)
  .transform((id) => id as BookUuid);

/** Brands a route parameter as a book uuid, or `null` when it is empty. */
export function parseBookUuid(raw: string | null | undefined): BookUuid | null {
  const parsed = bookUuid.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function requireUuid(raw: string | null | undefined, id: number): BookUuid {
  const uuid = parseBookUuid(raw);
  if (!uuid) throw new Error(`book ${id} has no uuid`);
  return uuid;
}

export type FilterField =
  | "tag"
  | "genre"
  | "author"
  | "series"
  | "format"
  | "shelf";
export type FilterMode = "include" | "exclude";
export type FilterClause = {
  field: FilterField;
  mode: FilterMode;
  values: string[];
};

export type UserId = number & { readonly __brand: "UserId" };

/** The screen's shape of the user `GET /api/auth/me` and sign-in answer with. */
export function toUser(user: UserSummary) {
  return {
    id: user.id as UserId,
    username: user.username,
    name: user.display_name ?? user.username,
    isAdmin: user.is_admin,
    canUpload: user.can_upload,
    hasAvatar: user.has_avatar ?? false,
    hiddenFormats: user.hidden_formats ?? [],
    stackSeries: user.stack_series ?? false,
    canEdit: user.can_edit,
  };
}

export type User = ReturnType<typeof toUser>;

function toBook(wire: EbookMetadata) {
  // An empty name is a cleared series, not a series called "".
  const series = wire.series?.trim()
    ? { name: wire.series, index: wire.series_index ?? null }
    : null;
  return {
    uuid: requireUuid(wire.unique_identifier, wire.id),
    title: wire.title?.trim() ? wire.title : wire.filename,
    authors: wire.creators.map((c) => c.name),
    series,
    accent: wire.accent ?? null,
    hasCover: wire.cover_url != null,
  };
}

export type Book = ReturnType<typeof toBook>;

/** The screen's shape of `GET /api/ebooks/{uuid}`. */
export function toBookDetail(wire: EbookMetadata) {
  return {
    ...toBook(wire),
    description: wire.description ?? null,
    published: wire.published ?? null,
    genres: wire.genres ?? [],
    subjects: wire.subjects,
  };
}

export type BookDetail = ReturnType<typeof toBookDetail>;

/** The screen's shape of one `GET /api/progress/recent` entry. */
export function toResumePoint({ record, book }: ResumePointWire) {
  return {
    book: toBook(book),
    format: record.format,
    fileId: record.book_file_id ?? null,
    formats: book.formats ?? [],
  };
}

export type ResumePoint = ReturnType<typeof toResumePoint>;

export type AuthorId = number & { readonly __brand: "AuthorId" };
export type SeriesId = number & { readonly __brand: "SeriesId" };

/** The screen's shape of `GET /api/search/palette`: capped hits, true totals. */
export function toPalette(wire: PaletteWire) {
  const totals = {
    books: wire.book_total ?? 0,
    authors: wire.author_total ?? 0,
    series: wire.series_total ?? 0,
    tags: wire.tag_total ?? 0,
    genres: wire.genre_total ?? 0,
  };
  return {
    books: wire.books.map((b) => ({
      uuid: requireUuid(b.uuid, b.id),
      title: b.title,
      authorDisplay: b.author_display,
      year: b.year ?? null,
      formats: b.formats,
      hasCover: b.cover_url != null,
      accent: b.accent ?? null,
    })),
    authors: wire.authors.map((a) => ({
      id: a.id as AuthorId,
      name: a.name,
      bookCount: a.book_count,
      leadBookTitle: a.lead_book_title ?? null,
    })),
    series: wire.series.map((s) => ({
      id: s.id as SeriesId,
      name: s.name,
      bookCount: s.book_count,
      authorDisplay: s.author_display ?? null,
      leadBookTitle: s.lead_book_title ?? null,
    })),
    tags: wire.tags.map((t) => ({
      id: t.id,
      name: t.name,
      bookCount: t.book_count,
    })),
    genres: (wire.genres ?? []).map((g) => ({
      name: g.name,
      bookCount: g.book_count,
    })),
    durationMs: wire.duration_ms,
    total: Object.values(totals).reduce((sum, n) => sum + n, 0),
    totals,
  };
}

export type PaletteResults = ReturnType<typeof toPalette>;

/** One book hit in the palette or on the results page. */
export type PaletteBook = PaletteResults["books"][number];

export type BookPage = {
  books: Book[];
  total: number;
  next: string | null;
  hidden: number | null;
  path: string | null;
};

const countHeader = z.coerce.number().int().nonnegative();

/** The screen's shape of one page of `GET /api/ebooks`, whose paging is in headers. */
export function toBookPage(page: EbookPage, headers: Headers): BookPage {
  const books = page.books.map(toBook);
  const hidden = headers.get("X-Hidden-Count");
  return {
    books,
    total: countHeader.parse(headers.get("X-Total-Count") ?? books.length),
    next: headers.get("X-Next-Cursor"),
    hidden: hidden === null ? null : countHeader.parse(hidden),
    path: page.path ?? null,
  };
}

/** A non-2xx answer, carrying the status and the server's plain-text body. */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function failure(res: { status: number; data: unknown }): ApiError {
  const message =
    typeof res.data === "string" && res.data
      ? res.data
      : `Request failed with status ${res.status}.`;
  return new ApiError(res.status, message);
}

/** The signed-in user, or `null` when the session cookie is missing or dead. */
export async function fetchMe(): Promise<User | null> {
  const res = await getMe();
  if (res.status === 401) return null;
  if (res.status !== 200) throw failure(res);
  return toUser(res.data);
}

/** What the sign-in form must hold before it may submit. */
export const CredentialsSchema = z.object({
  username: z.string().min(1, "Enter your username."),
  password: z.string().min(1, "Enter your password."),
});

export type Credentials = z.infer<typeof CredentialsSchema>;

/** Opens a cookie session; the server sets the cookie on the response. */
export async function login(credentials: Credentials): Promise<User> {
  const res = await postLogin(credentials);
  if (res.status !== 200) throw failure(res);
  return toUser(res.data.user);
}

/** Opens a cookie session for a new account; the server sets the cookie. */
export async function register(credentials: Credentials): Promise<User> {
  const res = await postRegister(credentials);
  if (res.status !== 200) throw failure(res);
  return toUser(res.data.user);
}

/** Whether self-registration is open; an admin can close it. */
export async function fetchRegistrationOpen(): Promise<boolean> {
  const res = await getRegistration();
  if (res.status !== 200) throw failure(res);
  return res.data.enabled;
}

export async function logout(): Promise<void> {
  // The generated fetcher JSON-parses any body, and an error's is plain text.
  const res = await fetch(getLogoutUrl(), { method: "POST" });
  if (res.status !== 204) {
    throw failure({ status: res.status, data: await res.text() });
  }
}

/** What a library page is fetched under; a change to any of it restarts at page 1. */
export type LibraryQuery = { sort: SortKey; dir: SortDir };

export const PAGE_SIZE = 100;

/** One page of the library in `query`'s order; pass `""` for the first page. */
export async function fetchBookPage(
  query: LibraryQuery,
  cursor: string,
): Promise<BookPage> {
  // The API refuses a cursor unless sort and dir are both explicit.
  const res = await getEbooks({
    sort: query.sort,
    dir: query.dir,
    limit: PAGE_SIZE,
    omit_description: true,
    ...(cursor ? { cursor } : {}),
  });
  if (res.status !== 200) throw failure(res);
  return toBookPage(res.data, res.headers);
}

/** The full record for one book, or `null` when no book has that uuid. */
export async function fetchBook(uuid: BookUuid): Promise<BookDetail | null> {
  const res = await getEbookByUuid(encodeURIComponent(uuid));
  if (res.status === 404) return null;
  if (res.status !== 200) throw failure(res);
  return toBookDetail(res.data);
}

/** The reader's most recent reading and listening positions, newest first. */
export async function fetchRecentProgress(
  limit: number,
): Promise<ResumePoint[]> {
  const res = await getRecentProgress({ limit });
  if (res.status !== 200) throw failure(res);
  return res.data.map(toResumePoint);
}

/** Grouped search hits for `query`; `limit` raises the per-group cap. */
export async function fetchPalette(
  query: string,
  { limit, signal }: { limit?: number; signal?: AbortSignal } = {},
): Promise<PaletteResults> {
  const res = await getSearchPalette({ q: query, limit }, { signal });
  if (res.status !== 200) throw failure(res);
  return toPalette(res.data);
}

export const thumbUrl = (uuid: BookUuid, size: "sm" | "md" = "md") =>
  `/api/thumbs/${uuid}/${size}`;

export const thumbSrcSet = (uuid: BookUuid) =>
  `/api/thumbs/${uuid}/sm 160w, /api/thumbs/${uuid}/md 320w, /api/thumbs/${uuid}/lg 640w`;

export const coverUrl = (uuid: BookUuid) => `/api/covers/${uuid}`;

export const avatarUrl = (id: UserId) => `/api/users/${id}/avatar`;
