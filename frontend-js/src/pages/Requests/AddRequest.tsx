import { useState } from "react";
import { type FoundBook, parseBookUuid, type RequestListing } from "../../api";
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
  const start = useStartRequest(null, { stay: true });
  if (!viewer.canRequest) return null;
  // Whether anything is already requested is unknown until the lists answer.
  if (listings === undefined) {
    return (
      <span className="rqs-add-wait" data-testid="requests-add-wait">
        <Skeleton shape="block" />
      </span>
    );
  }
  const notes = requestedNotes(listings, viewer);
  const show = (uuid: string) => {
    setOpen(false);
    onSelect(uuid);
  };
  const libraryOffer = (book: FoundBook): Offer => {
    const year = phone ? null : book.year;
    const requested = notes.get(book.uuid);
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
        run: () =>
          start.mutate({ uuid }, { onSuccess: (r) => show(r.bookUuid) }),
      },
    };
  };
  const offer = (hit: Hit): Offer =>
    hit.kind === "library"
      ? libraryOffer(hit.book)
      : { note: phone ? line(hit.meta.year) : undefined, action: null };
  return (
    <BookSearch
      open={open}
      onOpenChange={setOpen}
      testId="requests-add"
      copy={{
        button: "Request",
        name: "Request a book",
        title: "Request a book",
        hint: "Title, author or ISBN. Starts an ebook request.",
      }}
      busy={start.isPending}
      error={null}
      offer={offer}
    />
  );
}
