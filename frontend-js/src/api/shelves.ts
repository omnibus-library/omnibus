import { z } from "zod";
import type { BookUuid, UserId } from "./core";
import { fetchJson, ok, parseBookUuid, send } from "./core";
import {
  getAddShelfBooksUrl,
  getRemoveShelfBookUrl,
  getShelvesContainingUrl,
  getSmartShelvesContainingUrl,
  listShelves,
} from "./generated/omnibus";
import type { ShelfSummary as ShelfSummaryWire } from "./generated/schemas";

function toShelf(wire: ShelfSummaryWire) {
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

/** Every shelf the reader can see. */
export async function fetchShelves(): Promise<Shelf[]> {
  return ok(await listShelves()).map(toShelf);
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
