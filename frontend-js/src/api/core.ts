import { z } from "zod";

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

export function requireUuid(
  raw: string | null | undefined,
  id: number,
): BookUuid {
  const uuid = parseBookUuid(raw);
  if (!uuid) throw new Error(`book ${id} has no uuid`);
  return uuid;
}

export type UserId = number & { readonly __brand: "UserId" };

export type AuthorId = number & { readonly __brand: "AuthorId" };
export type SeriesId = number & { readonly __brand: "SeriesId" };

const positiveInt = (raw: string | null | undefined) =>
  raw && /^[1-9]\d*$/.test(raw) ? Number(raw) : null;

/** Brands a route parameter as an author id, or `null` unless it is a positive integer. */
export function parseAuthorId(raw: string | null | undefined): AuthorId | null {
  return positiveInt(raw) as AuthorId | null;
}

/** Brands a route parameter as a series id, or `null` unless it is a positive integer. */
export function parseSeriesId(raw: string | null | undefined): SeriesId | null {
  return positiveInt(raw) as SeriesId | null;
}

/** A route parameter as a shelf id, or `null` unless it is a positive integer. */
export function parseShelfId(raw: string | null | undefined): number | null {
  return positiveInt(raw);
}

/** A non-2xx answer, carrying the status and the server's plain-text body. */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function failure(res: { status: number; data: unknown }): ApiError {
  const message =
    typeof res.data === "string" && res.data
      ? res.data
      : `Request failed with status ${res.status}.`;
  return new ApiError(res.status, message);
}

// orval types each answer with its literal status, so narrowing on 200 types the data.
export function ok<R extends { status: number; data: unknown }>(
  res: R,
): Extract<R, { status: 200 }>["data"] {
  if (res.status !== 200) throw failure(res);
  return res.data as Extract<R, { status: 200 }>["data"];
}

/** What the sign-in form must hold before it may submit. */
export const CredentialsSchema = z.object({
  username: z.string().min(1, "Enter your username."),
  password: z.string().min(1, "Enter your password."),
});

export type Credentials = z.infer<typeof CredentialsSchema>;

/** Runs `run` after the earlier task under `key` settles, so writes reach the server in the order made; a failure stalls nothing. */
export function inOrder<T>(
  chains: Map<string, Promise<void>>,
  key: string,
  run: () => Promise<T>,
): Promise<T> {
  const result = (chains.get(key) ?? Promise.resolve()).then(run);
  const tail = result.then(
    () => {},
    () => {},
  );
  chains.set(key, tail);
  // Dropped once idle, so the map holds only books with a write in flight.
  void tail.then(() => {
    if (chains.get(key) === tail) chains.delete(key);
  });
  return result;
}

// The generated fetcher JSON-parses every body, and an error's is plain text.
export async function send(
  url: string,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  body?: unknown,
): Promise<Response> {
  const res = await fetch(url, {
    method,
    ...(body === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  if (!res.ok) throw failure({ status: res.status, data: await res.text() });
  return res;
}

// orval emits no validator for a nullable or inline-array 200, so these reads parse here.
export async function fetchJson<T>(
  url: string,
  schema: z.ZodType<T>,
): Promise<T> {
  return schema.parse(await (await send(url, "GET")).json());
}

// Bumped when a cover is rewritten, so every URL built after it skips the browser's cached image.
const coverBusts = new Map<BookUuid, number>();

export const bumpCoverBust = (uuid: BookUuid) =>
  coverBusts.set(uuid, (coverBusts.get(uuid) ?? 0) + 1);

// The same for an avatar, which a reader replaces under the same URL.
const avatarBusts = new Map<UserId, number>();

const avatarWatchers = new Set<() => void>();

/** Calls `onChange` after any bump, so a mounted avatar redraws with the new URL. */
export const watchAvatarBusts = (onChange: () => void) => {
  avatarWatchers.add(onChange);
  return () => {
    avatarWatchers.delete(onChange);
  };
};

export const bumpAvatarBust = (id: UserId) => {
  avatarBusts.set(id, (avatarBusts.get(id) ?? 0) + 1);
  for (const onChange of avatarWatchers) onChange();
};

/** Forgets every bump, covers and avatars; a story starts from the image the server first sent. */
export const resetImageBusts = () => {
  coverBusts.clear();
  avatarBusts.clear();
};

/** `url` with the book's cover generation appended, once a write has bumped it. */
export const bustCover = (url: string, uuid: BookUuid) => {
  const n = coverBusts.get(uuid);
  return n ? `${url}?v=${n}` : url;
};

export const thumbUrl = (uuid: BookUuid, size: "sm" | "md" | "lg" = "md") =>
  bustCover(`/api/thumbs/${uuid}/${size}`, uuid);

export const thumbSrcSet = (uuid: BookUuid) =>
  `${thumbUrl(uuid, "sm")} 160w, ${thumbUrl(uuid, "md")} 320w, ${thumbUrl(uuid, "lg")} 640w`;

export const coverUrl = (uuid: BookUuid) =>
  bustCover(`/api/covers/${uuid}`, uuid);

export const avatarUrl = (id: UserId) => {
  const n = avatarBusts.get(id);
  return n ? `/api/users/${id}/avatar?v=${n}` : `/api/users/${id}/avatar`;
};
