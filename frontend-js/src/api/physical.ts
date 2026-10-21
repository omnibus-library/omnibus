import type { BookUuid, UserId } from "./core";
import { fetchJson, ok, send } from "./core";
import {
  deleteWishlistEntry,
  getDeleteFilelessBookUrl,
  getDeletePhysicalCopyUrl,
  getGetWishlistEntryUrl,
  listPhysicalCopies,
  patchCopyNote,
  postWishlistEntry,
} from "./generated/omnibus";
import type {
  PhysicalCopy as PhysicalCopyWire,
  WishlistEntry as WishlistEntryWire,
} from "./generated/schemas";
import { WishlistEntry as WishlistEntrySchema } from "./generated/schemas";

export function toCopy(wire: PhysicalCopyWire) {
  return {
    id: wire.id,
    filerId:
      wire.added_by_user_id == null ? null : (wire.added_by_user_id as UserId),
    // Absent once the filer's account is gone.
    filerName: wire.added_by_name ?? null,
    checkedInAt: wire.checked_in_at,
    isbn: wire.isbn ?? null,
    note: wire.note ?? null,
  };
}

export type PhysicalCopy = ReturnType<typeof toCopy>;

/** The checked-in physical copies of a book, every reader's. */
export async function fetchCopies(uuid: BookUuid): Promise<PhysicalCopy[]> {
  return ok(await listPhysicalCopies(encodeURIComponent(uuid))).map(toCopy);
}

/** Replaces a copy's note; a blank one clears it. */
export async function saveCopyNote(
  id: number,
  note: string,
): Promise<PhysicalCopy> {
  return toCopy(ok(await patchCopyNote(id, { note })));
}

export async function deleteCopy(id: number): Promise<void> {
  await send(getDeletePhysicalCopyUrl(id), "DELETE");
}

/** Deletes a book that has no files and no copies left. */
export async function deleteFilelessBook(uuid: BookUuid): Promise<void> {
  await send(getDeleteFilelessBookUrl(encodeURIComponent(uuid)), "DELETE");
}

function toWishlistEntry(wire: WishlistEntryWire) {
  return { addedAt: wire.added_at, source: wire.source };
}

export type WishlistEntry = ReturnType<typeof toWishlistEntry>;

/** The reader's wishlist entry for a book, or `null` when it is not on the list. */
export async function fetchWishlist(
  uuid: BookUuid,
): Promise<WishlistEntry | null> {
  const data = await fetchJson(
    getGetWishlistEntryUrl(encodeURIComponent(uuid)),
    WishlistEntrySchema.nullable(),
  );
  return data && toWishlistEntry(data);
}

export async function addToWishlist(uuid: BookUuid): Promise<WishlistEntry> {
  return toWishlistEntry(ok(await postWishlistEntry(encodeURIComponent(uuid))));
}

/** Takes a book off the wishlist; `bookDeleted` is true when a book with nothing else went with it. */
export async function removeFromWishlist(
  uuid: BookUuid,
): Promise<{ bookDeleted: boolean }> {
  return {
    bookDeleted: ok(await deleteWishlistEntry(encodeURIComponent(uuid)))
      .book_deleted,
  };
}
