import type { QueryClient } from "@tanstack/react-query";
import type { BookUuid } from "../../api";
import { forgetBook, refreshAround } from "../BookDetail/queries";

/** After a write on `uuid`: the wishlists, and the book's own copies, wish and shelf facts, are read again; a book that went with its last entry is forgotten instead. */
export function refreshAfterWrite(
  client: QueryClient,
  uuid: BookUuid,
  bookDeleted = false,
) {
  if (bookDeleted) forgetBook(client, uuid);
  return Promise.all([
    client.invalidateQueries({ queryKey: ["wishlists"] }),
    bookDeleted ? undefined : refreshAround(client, uuid),
  ]);
}
