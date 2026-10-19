import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import {
  addPhysicalOnly,
  checkInBook,
  resolveBook,
  wishlistScanned,
} from "../../api";
import type {
  ExternalBookMeta,
  ScanOutcome,
  WishlistAddRequest,
} from "../../api/generated/schemas";
import { PageTitle } from "../../components/PageTitle/PageTitle";
import {
  cleanIsbn,
  type FoundVia,
  isbnRejection,
  type Stage,
  someIfFilled,
  stageFor,
} from "./checkIn";
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

/** Check in: type an ISBN, then follow it wherever the ladder lands. */
export function CheckIn() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [stage, setStage] = useState<Stage>(LOOKUP);
  const [isbn, setIsbn] = useState("");
  const [note, setNote] = useState("");
  const [via, setVia] = useState<FoundVia>("isbn");
  const [error, setError] = useState<string | null>(null);

  // A copy or wishlist entry changes the book, the lists and the shelves that count it.
  const wrote = (uuid: string) => {
    for (const queryKey of [
      ["book", uuid],
      ["books"],
      ["shelves"],
      ["shelf-page"],
    ]) {
      queryClient.invalidateQueries({ queryKey });
    }
  };
  const arrive = (outcome: ScanOutcome, isbn: string) => {
    const next = stageFor(outcome, isbn);
    if (next) setStage(next);
    else if (outcome.kind === "already_owned") {
      navigate(`/books/${outcome.book.uuid}`);
    }
  };
  const restart = () => {
    setError(null);
    setNote("");
    setIsbn("");
    setVia("isbn");
    setStage(LOOKUP);
  };

  const resolve = useMutation({
    mutationFn: resolveBook,
    onSuccess: (outcome, cleaned) => arrive(outcome, cleaned),
    onError: (e) => {
      setError(`Could not look that up: ${e.message}`);
      setStage(LOOKUP);
    },
  });
  const checkIn = useMutation({
    mutationFn: (confirm: Extract<Stage, { kind: "confirm" }>) =>
      checkInBook({
        book_uuid: confirm.book.uuid,
        isbn: confirm.isbn,
        note: someIfFilled(note),
      }).then((uuid) => ({ uuid, confirm })),
    onSuccess: ({ uuid, confirm }) => {
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
      addPhysicalOnly({ meta, note: someIfFilled(note) }).then((uuid) => ({
        uuid,
        meta,
      })),
    onSuccess: ({ uuid, meta }) => {
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
    mutationFn: (req: WishlistAddRequest) =>
      wishlistScanned(req).then((uuid) => ({
        uuid,
        title: req.meta?.title ?? "",
      })),
    onSuccess: ({ uuid, title }) => {
      wrote(uuid);
      setStage({ kind: "wishlisted", title });
    },
    onError: (e) => setError(`Could not add to your wishlist: ${e.message}`),
  });
  const busy =
    resolve.isPending ||
    checkIn.isPending ||
    ownIt.isPending ||
    wishlist.isPending;

  const onResolve = (raw: string) => {
    const cleaned = cleanIsbn(raw);
    const rejection = isbnRejection(cleaned);
    if (rejection) {
      // Back to the screen they typed on, digits in place to correct.
      setError(rejection);
      setStage(LOOKUP);
      return;
    }
    setVia("isbn");
    setError(null);
    setStage({ kind: "resolving" });
    resolve.mutate(cleaned);
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
            via={via}
            note={note}
            busy={busy}
            onNote={setNote}
            onCheckIn={() => checkIn.mutate(stage)}
            onCancel={restart}
          />
        );
      case "closeMatch":
        return (
          <CloseMatchScreen
            books={stage.books}
            scanned={stage.scanned}
            via={via}
            onYes={(book) =>
              setStage({
                kind: "confirm",
                book,
                isbn: stage.scanned.isbn13,
                wishlisted: false,
              })
            }
            onNo={(online) => setStage({ kind: "choose", online })}
          />
        );
      case "choose":
        return (
          <ChooseScreen
            online={stage.online}
            via={via}
            busy={busy}
            onOwnIt={(meta) => ownIt.mutate(meta)}
            onWishlist={(req) => wishlist.mutate(req)}
            onRestart={restart}
          />
        );
      case "unresolved":
        return <UnresolvedScreen isbn={stage.isbn} onRestart={restart} />;
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

  return (
    <>
      <PageTitle page="Check in" />
      <section className="card check-in" data-testid="check-in">
        {/* Present on every stage so a mid-flow abort never strands the reader. */}
        <Link
          to="/"
          className="check-in-close"
          data-testid="check-in-close"
          aria-label="Cancel check-in"
          title="Cancel"
        >
          ×
        </Link>
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
    </>
  );
}
