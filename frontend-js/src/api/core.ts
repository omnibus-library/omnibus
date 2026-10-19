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

/** Forgets every bump; a story starts from the cover the server first sent. */
export const resetCoverBusts = () => coverBusts.clear();

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

export const avatarUrl = (id: UserId) => `/api/users/${id}/avatar`;
