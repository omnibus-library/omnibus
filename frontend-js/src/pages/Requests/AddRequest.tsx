import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  type ExternalBookMeta,
  type FoundBook,
  REQUEST_LISTS_KEY,
  type RequestListing,
  requestsQuery,
  startBookRequest,
  startRequestFromMeta,
} from "../../api";
import {
  BookSearch,
  type Hit,
  matchOf,
  type Offer,
} from "../../components/BookSearch/BookSearch";
import { Skeleton } from "../../components/Loading/Loading";
import { useToast } from "../../components/Toast/Toast";
import { useCurrentUser } from "../../session";
import { PHONE_QUERY, useMediaQuery } from "../../useMediaQuery";
import { holdsEbook, startFailure } from "../BookRequest/requestView";
import { requestedNotes } from "./requestGroups";

const line = (...parts: (string | null | undefined)[]) =>
  parts.filter(Boolean).join(" · ");

/** Whether the library already has an ebook of `book`. */
const hasEbook = (book: FoundBook) =>
  book.formats
    ? holdsEbook(book.formats)
    : // shortcut: a lookup by ISBN or by a provider's record sends no formats, so any file counts as an ebook; an audiobook-only book then offers no Request, until those lookups send its formats.
      book.has_files;

/** What a start is for: a library book, or a provider's record of one the library lacks. */
type Target = { uuid: string } | { meta: ExternalBookMeta };

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
  const toast = useToast();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const notes = requestedNotes(listings ?? [], viewer);
  const show = (uuid: string) => {
    setOpen(false);
    onSelect(uuid);
  };
  const start = useMutation({
    mutationFn: (target: Target) =>
      "meta" in target
        ? startRequestFromMeta(target.meta)
        : startBookRequest(target.uuid),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: REQUEST_LISTS_KEY });
      // The panel stays busy until the page's own list has the new request.
      return client.refetchQueries({
        queryKey: requestsQuery.queryKey,
        type: "all",
      });
    },
    onError: (e) => toast(startFailure(e)),
  });
  /** What a library book calls for: open its request, say its ebook is here, or start one. */
  const decide = (book: FoundBook) =>
    notes.has(book.uuid) ? "open" : hasEbook(book) ? "held" : "start";
  // A provider's record: the book it stands for, if the library has it, decides what the request is for.
  const record = useMutation({
    mutationFn: async (hit: Extract<Hit, { kind: "online" }>) => {
      const found = await matchOf(hit);
      const decision = found ? decide(found) : "start";
      if (found && decision === "open") return { uuid: found.uuid };
      if (found && decision === "held") return { held: hit.meta.title };
      // The mutation has already said why a start failed.
      const started = await start
        .mutateAsync(found ? { uuid: found.uuid } : { meta: hit.meta })
        .catch(() => null);
      return started ? { uuid: started.bookUuid } : null;
    },
    onMutate: () => setError(null),
    onSuccess: (landed) => {
      if (landed?.uuid) show(landed.uuid);
      else if (landed?.held)
        setError(`${landed.held} is already in the library.`);
    },
    onError: (_, hit) => setError(`Couldn’t look up ${hit.meta.title}.`),
  });
  if (!viewer.canStartRequests) return null;
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
    const decision = decide(book);
    if (decision === "open") {
      return {
        note: line(
          year,
          phone ? "requested" : `requested, ${notes.get(book.uuid)}`,
        ),
        action: {
          label: "Open",
          busyLabel: "Opening…",
          name: `Open ${book.title}`,
          run: () => show(book.uuid),
        },
      };
    }
    if (decision === "held") {
      return { note: line(year, "in the library"), action: null };
    }
    return {
      note: line(year),
      action: {
        label: "Request",
        busyLabel: "Requesting…",
        name: `Request ${book.title}`,
        run: () => {
          setError(null);
          start.mutate(
            { uuid: book.uuid },
            { onSuccess: (r) => show(r.bookUuid) },
          );
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
        busyLabel: "Requesting…",
        name: `Request ${hit.meta.title}`,
        run: () => record.mutate(hit),
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
