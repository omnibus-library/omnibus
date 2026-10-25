import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import {
  addPhysicalOnly,
  checkInBook,
  type ExternalBookMeta,
  resolveBook,
  resolveMeta,
  type ScanOutcome,
  type WishlistAddRequest,
  wishlistScanned,
} from "../../api";
import { Modal } from "../../components/Modal/Modal";
import { PageTitle } from "../../components/PageTitle/PageTitle";
import { useCurrentUser } from "../../session";
import {
  cleanIsbn,
  type FoundVia,
  isbnRejection,
  manualFallback,
  type Stage,
  someIfFilled,
  stageFor,
} from "./checkInFlow";
import { EntryScreen, ScanScreen } from "./EntryScan";
import { LinkExistingScreen } from "./LinkExisting";
import { LookupScreen } from "./Lookup";
import {
  ChooseScreen,
  CloseMatchScreen,
  ConfirmScreen,
  ResolvingScreen,
  SuccessScreen,
  UnresolvedScreen,
} from "./Screens";
import "../../styles/settings.css";
import "./CheckIn.css";

const LOOKUP: Stage = { kind: "lookup" };

/** Check in, in a dialog over the page: type an ISBN, then follow it wherever the ladder lands. */
export function CheckIn() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const viewerId = useCurrentUser().id;
  const [stage, setStage] = useState<Stage>(LOOKUP);
  // The book page's "Check in when acquired" brings the ISBN it already holds.
  const [params] = useSearchParams();
  const [isbn, setIsbn] = useState(params.get("isbn") ?? "");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  // A copy or wishlist entry changes the book, the lists and the shelves that count it.
  const wrote = (uuid: string) => {
    // A retry that lands must not keep the failure it recovered from.
    setError(null);
    for (const queryKey of [
      ["book", uuid],
      ["books"],
      ["shelves"],
      ["shelf-page"],
    ]) {
      queryClient.invalidateQueries({ queryKey });
    }
  };
  const arrive = (outcome: ScanOutcome, isbn: string, via: FoundVia) => {
    if (outcome.kind === "already_owned") {
      navigate(`/books/${outcome.book.uuid}`);
    } else {
      setStage(stageFor(outcome, isbn, via));
    }
  };
  const toStage = (next: Stage) => () => {
    setError(null);
    setStage(next);
  };
  const toSearch = toStage(LOOKUP);
  // Linking opens from the screen the reader is on, which Back returns to.
  const toLink = (isbn: string, via: FoundVia) => {
    setError(null);
    setStage({ kind: "link", isbn, origin: stage, via });
  };
  const restart = () => {
    setError(null);
    setNote("");
    setIsbn("");
    setStage(LOOKUP);
  };

  // `arrive` can navigate, so its callers pass it per call: TanStack drops those once the page is gone.
  const resolve = useMutation({
    mutationFn: ({ isbn }: { isbn: string; fallback: Stage }) =>
      resolveBook(isbn),
    onError: (e, { fallback }) => {
      setError(`Could not look that up: ${e.message}`);
      setStage(fallback);
    },
  });
  const pick = useMutation({
    mutationFn: resolveMeta,
    onMutate: () => setError(null),
    // Stays on the search screen with its results to retry from.
    onError: (e) => setError(`Could not match that book: ${e.message}`),
  });
  const checkIn = useMutation({
    mutationFn: (confirm: Extract<Stage, { kind: "confirm" }>) =>
      checkInBook({
        book_uuid: confirm.book.uuid,
        isbn: confirm.isbn,
        note: someIfFilled(note),
      }),
    onSuccess: (uuid, confirm) => {
      wrote(uuid);
      setStage({
        kind: "checkedIn",
        uuid,
        title: confirm.book.title,
        offWishlist: confirm.wishlisted,
      });
    },
    onError: (e) => setError(`Check-in failed: ${e.message}`),
  });
  const ownIt = useMutation({
    mutationFn: (meta: ExternalBookMeta) =>
      addPhysicalOnly({ meta, note: someIfFilled(note) }),
    onSuccess: (uuid, meta) => {
      wrote(uuid);
      setStage({
        kind: "checkedIn",
        uuid,
        title: meta.title,
        offWishlist: false,
      });
    },
    onError: (e) => setError(`Could not add that book: ${e.message}`),
  });
  const wishlist = useMutation({
    mutationFn: ({ req }: { req: WishlistAddRequest; title: string }) =>
      wishlistScanned(req),
    onSuccess: (uuid, { title }) => {
      wrote(uuid);
      setStage({ kind: "wishlisted", title });
    },
    onError: (e) => setError(`Could not add to your wishlist: ${e.message}`),
  });
  // Only a write may hold the dialog open; a lookup can always be walked away from.
  const writing = checkIn.isPending || ownIt.isPending || wishlist.isPending;
  const busy =
    resolve.isPending ||
    pick.isPending ||
    checkIn.isPending ||
    ownIt.isPending ||
    wishlist.isPending;

  const onResolve = (raw: string) => {
    // Only the camera produces a barcode read; the keypad and the lookup field are both typing.
    const via = stage.kind === "scan" ? "scan" : "isbn";
    const cleaned = cleanIsbn(raw);
    const rejection = isbnRejection(cleaned);
    // A bad decode must not strand the reader on a blank screen: back to a typing screen, digits in place.
    const fallback = manualFallback(stage);
    if (rejection) {
      setError(rejection);
      setStage(fallback);
      return;
    }
    setError(null);
    setStage({ kind: "resolving" });
    resolve.mutate(
      { isbn: cleaned, fallback },
      { onSuccess: (outcome) => arrive(outcome, cleaned, via) },
    );
  };

  // The screen the stage calls for.
  function screen() {
    switch (stage.kind) {
      case "lookup":
        return (
          <LookupScreen
            isbn={isbn}
            busy={busy}
            onIsbn={setIsbn}
            onResolve={onResolve}
            onScan={toStage({ kind: "scan" })}
            onPick={(meta) =>
              pick.mutate(meta, {
                onSuccess: (outcome) => arrive(outcome, meta.isbn13, "search"),
              })
            }
            onError={setError}
          />
        );
      case "scan":
        return (
          <ScanScreen
            onDetect={(isbn) => {
              setIsbn(isbn);
              onResolve(isbn);
            }}
            onManual={toStage({ kind: "entry" })}
            onSearch={toSearch}
          />
        );
      case "entry":
        return (
          <EntryScreen
            isbn={isbn}
            busy={busy}
            onIsbn={setIsbn}
            onResolve={onResolve}
            onScan={toStage({ kind: "scan" })}
            onSearch={toSearch}
          />
        );
      case "resolving":
        return <ResolvingScreen />;
      case "confirm":
        return (
          <ConfirmScreen
            book={stage.book}
            isbn={stage.isbn}
            wishlisted={stage.wishlisted}
            anotherWish={stage.anotherWish}
            wishing={wishlist.isPending}
            via={stage.via}
            viewerId={viewerId}
            note={note}
            busy={busy}
            onNote={setNote}
            onCheckIn={() => checkIn.mutate(stage)}
            onWishlist={(req) =>
              wishlist.mutate({ req, title: stage.book.title })
            }
            onCancel={restart}
          />
        );
      case "closeMatch":
        return (
          <CloseMatchScreen
            books={stage.books}
            scanned={stage.scanned}
            via={stage.via}
            onYes={(book) =>
              setStage({
                kind: "confirm",
                book,
                isbn: stage.scanned.isbn13,
                wishlisted: false,
                anotherWish: false,
                via: stage.via,
              })
            }
            onNo={(online) =>
              setStage({ kind: "choose", online, via: stage.via })
            }
          />
        );
      case "choose":
        return (
          <ChooseScreen
            online={stage.online}
            via={stage.via}
            busy={busy}
            onOwnIt={(meta) => ownIt.mutate(meta)}
            onLink={() => toLink(stage.online.isbn13, stage.via)}
            onWishlist={(req) =>
              wishlist.mutate({ req, title: req.meta?.title ?? "" })
            }
            onRestart={restart}
          />
        );
      case "link":
        return (
          <LinkExistingScreen
            busy={busy}
            onPick={(book) =>
              setStage({
                kind: "confirm",
                book,
                isbn: stage.isbn,
                wishlisted: false,
                anotherWish: false,
                via: stage.via,
              })
            }
            onBack={() => setStage(stage.origin)}
            onError={setError}
          />
        );
      case "unresolved":
        return (
          <UnresolvedScreen
            isbn={stage.isbn}
            onSearch={toSearch}
            onLink={() => toLink(stage.isbn, stage.via)}
            onRestart={restart}
          />
        );
      case "checkedIn":
        return (
          <SuccessScreen
            title={stage.title}
            headline="In your physical collection"
            bookUuid={stage.uuid}
            offWishlist={stage.offWishlist}
            onRestart={restart}
          />
        );
      case "wishlisted":
        return (
          <SuccessScreen
            title={stage.title}
            headline="On your wishlist"
            bookUuid={null}
            offWishlist={false}
            onRestart={restart}
          />
        );
      default: {
        const _exhaustive: never = stage;
        return _exhaustive;
      }
    }
  }

  // Back the way the reader came, else to the library, so Back never reopens the dialog.
  const close = () =>
    location.state?.fromApp ? navigate(-1) : navigate("/", { replace: true });

  return (
    <Modal
      label="Check in a book"
      backdropClass="check-in-overlay-scrim"
      dialogClass="check-in-overlay-panel"
      onClose={close}
      busy={writing}
    >
      <PageTitle page="Check in" />
      <section className="card check-in" data-testid="check-in">
        {/* Present on every stage so a mid-flow abort never strands the reader. */}
        <button
          type="button"
          className="check-in-close"
          data-testid="check-in-close"
          aria-label="Cancel check-in"
          title="Cancel"
          onClick={close}
          disabled={writing}
        >
          ×
        </button>
        {screen()}
        {error && (
          <p
            data-testid="check-in-error"
            role="alert"
            className="settings-status error"
          >
            {error}
          </p>
        )}
      </section>
    </Modal>
  );
}
