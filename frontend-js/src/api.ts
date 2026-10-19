import { z } from "zod";

// shortcut: these schemas hand-mirror shared/'s serde types and can drift;
// generate them from shared's schemars JSON Schema before this ships.

export type BookUuid = string & { readonly __brand: "BookUuid" };

const bookUuid = z
  .string()
  .min(1)
  .transform((id) => id as BookUuid);

/** Brands a route parameter as a book uuid, or `null` when it is empty. */
export function parseBookUuid(raw: string | undefined): BookUuid | null {
  const parsed = bookUuid.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export type UserId = number & { readonly __brand: "UserId" };

const UserSchema = z
  .object({
    id: z
      .number()
      .int()
      .transform((id) => id as UserId),
    username: z.string(),
    display_name: z.string().nullish(),
    is_admin: z.boolean(),
    can_upload: z.boolean(),
    has_avatar: z.boolean().default(false),
  })
  .transform((u) => ({
    id: u.id,
    username: u.username,
    name: u.display_name ?? u.username,
    isAdmin: u.is_admin,
    canUpload: u.can_upload,
    hasAvatar: u.has_avatar,
  }));

export type User = z.infer<typeof UserSchema>;

/** Parses the user `GET /api/auth/me` and the login response carry. */
export function parseUser(body: unknown): User {
  return UserSchema.parse(body);
}

const BookWire = z.object({
  unique_identifier: bookUuid,
  filename: z.string(),
  title: z.string().nullable(),
  creators: z.array(z.object({ name: z.string() })),
  series: z.string().nullable(),
  series_index: z.string().nullable(),
  cover_url: z.string().nullable(),
  accent: z.string().optional(),
});

function toBook(wire: z.output<typeof BookWire>) {
  // An empty name is a cleared series, not a series called "".
  const series = wire.series?.trim()
    ? { name: wire.series, index: wire.series_index }
    : null;
  return {
    uuid: wire.unique_identifier,
    title: wire.title ?? wire.filename,
    authors: wire.creators.map((c) => c.name),
    series,
    accent: wire.accent ?? null,
    hasCover: wire.cover_url !== null,
  };
}

const BookSchema = BookWire.transform(toBook);

export type Book = z.infer<typeof BookSchema>;

const BookDetailSchema = BookWire.extend({
  description: z.string().nullable(),
  published: z.string().nullable(),
  genres: z.array(z.string()).default([]),
  subjects: z.array(z.string()),
}).transform((wire) => ({
  ...toBook(wire),
  description: wire.description,
  published: wire.published,
  genres: wire.genres,
  subjects: wire.subjects,
}));

export type BookDetail = z.infer<typeof BookDetailSchema>;

const ResumePointSchema = z
  .object({
    record: z.object({
      format: z.enum(["epub", "audio"]),
      book_file_id: z.number().int().nullish(),
    }),
    book: BookWire.extend({ formats: z.array(z.string()).default([]) }),
  })
  .transform(({ record, book }) => ({
    book: toBook(book),
    format: record.format,
    fileId: record.book_file_id ?? null,
    formats: book.formats,
  }));

export type ResumePoint = z.infer<typeof ResumePointSchema>;

/** Parses `GET /api/progress/recent`, newest position first. */
export function parseResumePoints(body: unknown): ResumePoint[] {
  return z.array(ResumePointSchema).parse(body);
}

export type AuthorId = number & { readonly __brand: "AuthorId" };
export type SeriesId = number & { readonly __brand: "SeriesId" };

const authorId = z
  .number()
  .int()
  .transform((id) => id as AuthorId);
const seriesId = z
  .number()
  .int()
  .transform((id) => id as SeriesId);
const total = z.number().int().nonnegative().default(0);

const PaletteSchema = z
  .object({
    books: z.array(
      z.object({
        uuid: bookUuid,
        title: z.string(),
        author_display: z.string(),
        year: z.string().nullish(),
        formats: z.array(z.string()),
        cover_url: z.string().nullish(),
        accent: z.string().nullish(),
      }),
    ),
    authors: z.array(
      z.object({
        id: authorId,
        name: z.string(),
        book_count: z.number().int(),
        lead_book_title: z.string().nullish(),
      }),
    ),
    series: z.array(
      z.object({
        id: seriesId,
        name: z.string(),
        book_count: z.number().int(),
        author_display: z.string().nullish(),
        lead_book_title: z.string().nullish(),
      }),
    ),
    tags: z.array(
      z.object({
        id: z.number().int(),
        name: z.string(),
        book_count: z.number().int(),
      }),
    ),
    genres: z
      .array(z.object({ name: z.string(), book_count: z.number().int() }))
      .default([]),
    duration_ms: z.number().nonnegative(),
    book_total: total,
    author_total: total,
    series_total: total,
    tag_total: total,
    genre_total: total,
  })
  .transform((wire) => ({
    books: wire.books.map((b) => ({
      uuid: b.uuid,
      title: b.title,
      authorDisplay: b.author_display,
      year: b.year ?? null,
      formats: b.formats,
      hasCover: b.cover_url != null,
      accent: b.accent ?? null,
    })),
    authors: wire.authors.map((a) => ({
      id: a.id,
      name: a.name,
      bookCount: a.book_count,
      leadBookTitle: a.lead_book_title ?? null,
    })),
    series: wire.series.map((s) => ({
      id: s.id,
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
    genres: wire.genres.map((g) => ({ name: g.name, bookCount: g.book_count })),
    durationMs: wire.duration_ms,
    totals: {
      books: wire.book_total,
      authors: wire.author_total,
      series: wire.series_total,
      tags: wire.tag_total,
      genres: wire.genre_total,
    },
  }));

export type PaletteResults = z.infer<typeof PaletteSchema>;

/** Parses `GET /api/search/palette`: capped hits per group, true totals. */
export function parsePalette(body: unknown): PaletteResults {
  return PaletteSchema.parse(body);
}

export type BookPage = { books: Book[]; total: number; next: string | null };

const BookPageSchema = z.object({ books: z.array(BookSchema) });
const countHeader = z.coerce.number().int().nonnegative();

/** Parses one keyset page of `GET /api/ebooks`, whose paging is in headers. */
export function parseBookPage(body: unknown, headers: Headers): BookPage {
  const { books } = BookPageSchema.parse(body);
  return {
    books,
    total: countHeader.parse(headers.get("X-Total-Count") ?? books.length),
    next: headers.get("X-Next-Cursor"),
  };
}

/** Parses `GET /api/ebooks/{uuid}`. */
export function parseBookDetail(body: unknown): BookDetail {
  return BookDetailSchema.parse(body);
}

/** A non-2xx answer, carrying the status and the server's plain-text body. */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function ensureOk(res: Response): Promise<void> {
  if (!res.ok) {
    throw new ApiError(res.status, (await res.text()) || res.statusText);
  }
}

async function readJson(res: Response): Promise<unknown> {
  await ensureOk(res);
  return res.json();
}

/** The signed-in user, or `null` when the session cookie is missing or dead. */
export async function fetchMe(): Promise<User | null> {
  const res = await fetch("/api/auth/me");
  if (res.status === 401) return null;
  return UserSchema.parse(await readJson(res));
}

/** What the sign-in form must hold before it may submit. */
export const CredentialsSchema = z.object({
  username: z.string().min(1, "Enter your username."),
  password: z.string().min(1, "Enter your password."),
});

export type Credentials = z.infer<typeof CredentialsSchema>;

/** Opens a cookie session; the server sets the cookie on the response. */
export async function login(credentials: Credentials): Promise<User> {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(credentials),
  });
  return z.object({ user: UserSchema }).parse(await readJson(res)).user;
}

export async function logout(): Promise<void> {
  await ensureOk(await fetch("/api/auth/logout", { method: "POST" }));
}

/** One title-sorted page of the library; pass `""` for the first page. */
export async function fetchBookPage(cursor: string): Promise<BookPage> {
  // The API refuses a cursor unless sort and dir are both explicit.
  const params = new URLSearchParams({
    sort: "title",
    dir: "asc",
    limit: "60",
    omit_description: "true",
  });
  if (cursor) params.set("cursor", cursor);
  const res = await fetch(`/api/ebooks?${params}`);
  return parseBookPage(await readJson(res), res.headers);
}

/** The full record for one book, or `null` when no book has that uuid. */
export async function fetchBook(uuid: BookUuid): Promise<BookDetail | null> {
  const res = await fetch(`/api/ebooks/${encodeURIComponent(uuid)}`);
  if (res.status === 404) return null;
  return parseBookDetail(await readJson(res));
}

/** The reader's most recent reading and listening positions, newest first. */
export async function fetchRecentProgress(
  limit: number,
): Promise<ResumePoint[]> {
  const res = await fetch(`/api/progress/recent?limit=${limit}`);
  return parseResumePoints(await readJson(res));
}

/** Grouped search hits for `query`; `limit` raises the per-group cap. */
export async function fetchPalette(
  query: string,
  { limit, signal }: { limit?: number; signal?: AbortSignal } = {},
): Promise<PaletteResults> {
  const params = new URLSearchParams({ q: query });
  if (limit !== undefined) params.set("limit", String(limit));
  const res = await fetch(`/api/search/palette?${params}`, { signal });
  return parsePalette(await readJson(res));
}

export const thumbUrl = (uuid: BookUuid, size: "sm" | "md" = "md") =>
  `/api/thumbs/${uuid}/${size}`;

export const thumbSrcSet = (uuid: BookUuid) =>
  `/api/thumbs/${uuid}/sm 160w, /api/thumbs/${uuid}/md 320w, /api/thumbs/${uuid}/lg 640w`;

export const coverUrl = (uuid: BookUuid) => `/api/covers/${uuid}`;

export const avatarUrl = (id: UserId) => `/api/users/${id}/avatar`;
