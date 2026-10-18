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

const UserSchema = z
  .object({ username: z.string(), display_name: z.string().nullish() })
  .transform((u) => ({ name: u.display_name ?? u.username }));

export type User = z.infer<typeof UserSchema>;

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

export type Credentials = { username: string; password: string };

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

export const thumbUrl = (uuid: BookUuid) => `/api/thumbs/${uuid}/md`;

export const thumbSrcSet = (uuid: BookUuid) =>
  `/api/thumbs/${uuid}/sm 160w, /api/thumbs/${uuid}/md 320w, /api/thumbs/${uuid}/lg 640w`;

export const coverUrl = (uuid: BookUuid) => `/api/covers/${uuid}`;
