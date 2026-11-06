import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import {
  type ExternalBookMeta,
  type FoundBook,
  parseBookUuid,
  type RequestListing,
  resolveMeta,
} from "../../api";
import {
  BookSearch,
  type Hit,
  type Offer,
} from "../../components/BookSearch/BookSearch";
import { Skeleton } from "../../components/Loading/Loading";
import { useCurrentUser } from "../../session";
import { PHONE_QUERY, useMediaQuery } from "../../useMediaQuery";
import { holdsEbook } from "../BookRequest/requestView";
import { useStartRequest } from "../BookRequest/useStartRequest";
import { existingBook } from "../Wishlists/wishlistView";
import { requestedNotes } from "./requestGroups";

const line = (...parts: (string | null | undefined)[]) =>
  parts.filter(Boolean).join(" · ");

/** Whether the library already has an ebook of `book`. */
const hasEbook = (book: FoundBook) =>
  book.formats
    ? holdsEbook(book.formats)
    : // shortcut: an ISBN lookup sends no formats, so any file counts as an ebook; an audiobook-only book then offers no Request, until the lookup sends its formats.
      book.has_files;

/** The Request button and the search it opens, which starts an ebook request on the book the reader finds. `listings` are the lists the page shows, which say what is already requested. `onSelect` is told the book to show once its request stands. */
export function AddRequest({
  listings,
  onSelect,
}: {
  listings: readonly RequestListing[] | undefined;
  onSelect: (uuid: string) => void;
}) {
  const viewer = useCurrentUser();
  const phone = useMediaQuery(PHONE_QUERY);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const start = useStartRequest(null, { stay: true });
  const notes = listings && requestedNotes(listings, viewer);
  const show = (uuid: string) => {
    setOpen(false);
    onSelect(uuid);
  };
  // A provider's record: the book it stands for, if the library has it, decides what the request is for.
  const record = useMutation({
    mutationFn: async ({
      meta,
      matchedNone,
    }: {
      meta: ExternalBookMeta;
      /** An ISBN lookup already found no library book for it. */
      matchedNone: boolean;
    }) => {
      const found = matchedNone ? null : existingBook(await resolveMeta(meta));
      if (found && notes?.has(found.uuid)) return { uuid: found.uuid };
      if (found && hasEbook(found)) return { held: meta.title };
      const uuid = found && parseBookUuid(found.uuid);
      const target = uuid ? { uuid } : { meta };
      // The hook has already said why a start failed.
      const started = await start.mutateAsync(target).catch(() => null);
      return started ? { uuid: started.bookUuid } : null;
    },
    onMutate: () => setError(null),
    onSuccess: (landed) => {
      if (landed?.uuid) show(landed.uuid);
      else if (landed?.held)
        setError(`${landed.held} is already in the library.`);
    },
    onError: (_, { meta }) => setError(`Couldn’t look up ${meta.title}.`),
  });
  if (!viewer.canRequest) return null;
  // Whether anything is already requested is unknown until the lists answer.
  if (listings === undefined) {
    return (
      <span className="rqs-add-wait" data-testid="requests-add-wait">
        <Skeleton shape="block" />
      </span>
    );
  }
  const libraryOffer = (book: FoundBook): Offer => {
    const year = phone ? null : book.year;
    const requested = notes?.get(book.uuid);
    if (requested !== undefined) {
      return {
        note: line(year, phone ? "requested" : `requested, ${requested}`),
        action: {
          label: "Open",
          name: `Open ${book.title}`,
          run: () => show(book.uuid),
        },
      };
    }
    const uuid = parseBookUuid(book.uuid);
    if (hasEbook(book) || uuid === null) {
      return { note: line(year, "in the library"), action: null };
    }
    return {
      note: line(year),
      action: {
        label: "Request",
        name: `Request ${book.title}`,
        run: () => {
          setError(null);
          start.mutate({ uuid }, { onSuccess: (r) => show(r.bookUuid) });
        },
      },
    };
  };
  const offer = (hit: Hit): Offer => {
    if (hit.kind === "library") return libraryOffer(hit.book);
    // An ISBN lookup has already matched the record to a library book.
    if (hit.matched) return libraryOffer(hit.matched);
    return {
      note: phone ? line(hit.meta.year) : undefined,
      action: {
        label: "Request",
        name: `Request ${hit.meta.title}`,
        run: () =>
          record.mutate({ meta: hit.meta, matchedNone: hit.matched === null }),
      },
    };
  };
  return (
    <BookSearch
      open={open}
      onOpenChange={(next) => {
        if (!next) setError(null);
        setOpen(next);
      }}
      testId="requests-add"
      copy={{
        button: "Request",
        name: "Request a book",
        title: "Request a book",
        hint: phone
          ? "Title, author or ISBN. The scan button reads the barcode on the back cover. Starts an ebook request."
          : "Title, author or ISBN. Starts an ebook request.",
      }}
      scan
      busy={start.isPending || record.isPending}
      error={error}
      offer={offer}
    />
  );
}
