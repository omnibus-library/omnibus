import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  type BookUuid,
  fetchWishlist,
  parseBookUuid,
  removeFromWishlist,
  type ScanBook,
  wishlistScanned,
} from "../../api";
import {
  BookSearch,
  type Hit,
  matchOf,
  type Offer,
  titleOf,
} from "../../components/BookSearch/BookSearch";
import { useToast } from "../../components/Toast/Toast";
import { type FoundVia, wishlistSource } from "../CheckIn/checkInFlow";
import { refreshAfterWrite } from "./refresh";

/** The write for a hit: a provider's record that matches a library book goes against that book, and only one that matches none is made into a new one. */
async function requestFor(hit: Hit, via: FoundVia) {
  const source = wishlistSource[via];
  if (hit.kind === "library") return { book_uuid: hit.book.uuid, source };
  const found = await matchOf(hit);
  return found ? { book_uuid: found.uuid, source } : { meta: hit.meta, source };
}

/** Adds to your own list, and says whether the book was already on it: Undo must never remove an entry that was there before. */
async function addHit(hit: Hit, via: FoundVia) {
  const request = await requestFor(hit, via);
  const target =
    "book_uuid" in request ? parseBookUuid(request.book_uuid) : null;
  // A record made into a new book cannot have been listed, and a read that fails stops the add.
  const alreadyListed = target ? (await fetchWishlist(target)) !== null : false;
  const uuid = await wishlistScanned(request);
  return { uuid: parseBookUuid(uuid), alreadyListed };
}

const libraryNote = (book: ScanBook) =>
  book.has_files
    ? "in the library"
    : book.has_physical
      ? "print copy in the library"
      : "on a wishlist";

/** The Add to wishlist button and the panel it opens. */
export function AddToWishlist({
  open,
  onOpenChange,
  asks,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Counts the top bar's Add menu asking for the search, which focuses its field each time. */
  asks: number;
}) {
  const client = useQueryClient();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);

  const undo = (uuid: BookUuid, title: string) => async () => {
    try {
      await removeFromWishlist(uuid);
      await refreshAfterWrite(client, uuid);
    } catch (e) {
      toast(
        `Couldn’t take ${title} off: ${e instanceof Error ? e.message : "try again."}`,
      );
    }
  };
  const add = useMutation({
    mutationFn: ({ hit, via }: { hit: Hit; via: FoundVia }) => addHit(hit, via),
    onMutate: () => setError(null),
    onSuccess: ({ uuid, alreadyListed }, { hit }) => {
      const title = titleOf(hit);
      // Undo would delete an entry that was there before this add.
      if (alreadyListed) {
        toast(`${title} is already on your wishlist`);
      } else {
        toast(
          `Added ${title} to your wishlist`,
          uuid ? { label: "Undo", onClick: undo(uuid, title) } : undefined,
        );
      }
      onOpenChange(false);
      return uuid ? refreshAfterWrite(client, uuid) : undefined;
    },
    onError: (e, { hit }) =>
      setError(`Couldn’t add ${titleOf(hit)}: ${e.message}`),
  });
  const offer = (hit: Hit): Offer => ({
    note: hit.kind === "library" ? libraryNote(hit.book) : undefined,
    action: {
      label: "Add",
      busyLabel: "Adding…",
      name: `Add ${titleOf(hit)}`,
      run: (via) => add.mutate({ hit, via }),
    },
  });
  return (
    <BookSearch
      open={open}
      onOpenChange={(next) => {
        if (!next) setError(null);
        onOpenChange(next);
      }}
      asks={asks}
      testId="wishlists-add"
      copy={{
        button: "Add to wishlist",
        name: "Add to wishlist",
        title: "Add to your wishlist",
        hint: "Title, author or ISBN. Adds to your wishlist.",
      }}
      busy={add.isPending}
      error={error}
      offer={offer}
    />
  );
}
