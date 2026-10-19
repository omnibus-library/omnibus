import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import type { Book } from "./books";
import { toBook } from "./books";
import type { BookUuid, UserId } from "./core";
import { failure, fetchJson, ok, parseBookUuid, send } from "./core";
import {
  getAddShelfBooksUrl,
  getDeleteShelfUrl,
  getRemoveShelfBookUrl,
  getShelf,
  getShelfPage,
  getShelvesContainingUrl,
  getSmartShelvesContainingUrl,
  listShelves,
  updateShelf as patchShelf,
  createShelf as postShelf,
  previewShelfRule as postShelfPreview,
} from "./generated/omnibus";
import type {
  CreateShelfRequest,
  RulePreviewRequest,
  ShelfSummary as ShelfSummaryWire,
  Shelf as ShelfWire,
  UpdateShelfRequest,
} from "./generated/schemas";
import type { LibraryQuery } from "./library";
import { filterParam } from "./library";

/** The screen's shape of one `GET /api/shelves` entry. */
export function toShelf(wire: ShelfSummaryWire) {
  return {
    id: wire.id,
    kind: wire.kind,
    name: wire.name,
    visibility: wire.visibility,
    accent: wire.accent ?? null,
    bookCount: wire.book_count,
    // Up to four members that have a cover, for the ledge.
    covers: (wire.cover_uuids ?? []).flatMap((u) => parseBookUuid(u) ?? []),
    owner: {
      id: wire.owner_user_id as UserId,
      name: wire.owner_username,
      hasAvatar: wire.owner_has_avatar ?? false,
    },
  };
}

export type Shelf = ReturnType<typeof toShelf>;
export type ShelfKind = Shelf["kind"];

/** Every shelf the reader can see. */
export async function fetchShelves(): Promise<Shelf[]> {
  return ok(await listShelves()).map(toShelf);
}

export const shelvesQuery = queryOptions({
  queryKey: ["shelves"],
  queryFn: fetchShelves,
});

/** The screen's shape of `GET /api/shelves/{id}`: the summary plus what the editor and the hero need. */
export function toShelfDetail(wire: ShelfWire) {
  return {
    ...toShelf(wire),
    description: wire.description ?? null,
    matchMode: wire.match_mode ?? null,
    rules: wire.rules,
    syncToKobo: wire.sync_to_kobo ?? false,
  };
}

export type ShelfDetail = ReturnType<typeof toShelfDetail>;

/** One shelf in full, or `null` when it is gone or the reader may not see it. */
export async function fetchShelf(id: number): Promise<ShelfDetail | null> {
  const res = await getShelf(id);
  if (res.status === 404) return null;
  return toShelfDetail(ok(res));
}

export const shelfQuery = (id: number) =>
  queryOptions({
    queryKey: ["shelf", id],
    queryFn: () => fetchShelf(id),
  });

/** Refetches everything that shows shelf `id` after a write to it; resolves once the active ones have answered. */
export function invalidateShelf(client: QueryClient, id: number) {
  return Promise.all(
    [["shelves"], ["shelf", id], ["shelf-page", id]].map((queryKey) =>
      client.invalidateQueries({ queryKey }),
    ),
  );
}

/** Creates a shelf the reader owns. */
export async function createShelf(
  body: CreateShelfRequest,
): Promise<ShelfDetail> {
  const res = await postShelf(body);
  if (res.status !== 201) throw failure(res);
  return toShelfDetail(res.data);
}

/** Changes the fields sent and leaves the rest. */
export async function updateShelf(
  id: number,
  body: UpdateShelfRequest,
): Promise<ShelfDetail> {
  return toShelfDetail(ok(await patchShelf(id, body)));
}

/** Deletes a shelf; its books stay in the library. */
export async function deleteShelf(id: number): Promise<void> {
  await send(getDeleteShelfUrl(id), "DELETE");
}

/** How many books the rules match, out of the library, with up to 12 of them; nothing is saved. */
export async function previewShelfRule(body: RulePreviewRequest) {
  const data = ok(await postShelfPreview(body));
  return {
    matched: data.matched,
    total: data.total,
    sample: data.sample.map(toBook),
  };
}

/** One shelf's books, whole, in `query`'s order and narrowed by its clauses. */
export async function fetchShelfPage(
  id: number,
  query: Pick<LibraryQuery, "sort" | "dir" | "clauses">,
): Promise<Book[]> {
  const filter = filterParam(query.clauses);
  const res = ok(
    await getShelfPage(id, {
      sort: query.sort,
      dir: query.dir,
      ...(filter ? { filter } : {}),
    }),
  );
  return res.books.map(toBook);
}

/** Appends the books to a hand-picked shelf. */
export async function addShelfBooks(
  shelfId: number,
  uuids: BookUuid[],
): Promise<void> {
  await send(getAddShelfBooksUrl(shelfId), "POST", { book_uuids: uuids });
}

const shelfIds = z.array(z.number().int());

/** The ids of the hand-picked shelves holding a book. */
export async function fetchShelvesContaining(
  uuid: BookUuid,
): Promise<number[]> {
  return fetchJson(getShelvesContainingUrl(encodeURIComponent(uuid)), shelfIds);
}

/** The ids of the smart shelves whose rules match a book. */
export async function fetchSmartShelvesContaining(
  uuid: BookUuid,
): Promise<number[]> {
  return fetchJson(
    getSmartShelvesContainingUrl(encodeURIComponent(uuid)),
    shelfIds,
  );
}

/** Puts a book on a hand-picked shelf, or takes it off. */
export async function setShelfMember(
  shelfId: number,
  uuid: BookUuid,
  member: boolean,
): Promise<void> {
  if (member) {
    await send(getAddShelfBooksUrl(shelfId), "POST", { book_uuids: [uuid] });
  } else {
    await send(
      getRemoveShelfBookUrl(shelfId, encodeURIComponent(uuid)),
      "DELETE",
    );
  }
}
