import { useEffect } from "react";
import { useParams, useSearchParams } from "react-router";
import type { BookDetail } from "../../api";
import { parseBookUuid, positiveInt } from "../../api";
import { Loading } from "../../components/Loading/Loading";
import { PageError, PageNotFound } from "../../components/PageState/PageState";
import { PageTitle } from "../../components/PageTitle/PageTitle";
import {
  SearchPaletteOverlay,
  SearchPaletteProvider,
  useSearchPaletteOpen,
} from "../../components/SearchPalette/SearchPalette";
import { TopNav } from "../../components/TopNav/TopNav";
import { usePlayback } from "../../playback/PlaybackProvider";
import { Stage } from "./Stage";

function FailedOverlay() {
  return (
    <div className="lp-overlay" data-testid="listen-failed" role="alert">
      <p className="lp-overlay-title">Playback failed.</p>
      <p className="lp-overlay-detail">
        The audiobook could not be prepared or kept stalling. Reload the page to
        try again, or check the server logs for a transcode failure.
      </p>
    </div>
  );
}

function Frame({ book }: { book: BookDetail }) {
  const { ready, failed } = usePlayback();
  // Inert under the open palette, so focus can't wander behind its scrim.
  const inert = useSearchPaletteOpen();
  return (
    <div
      className="lp-root"
      style={book.accent ? { "--accent": book.accent } : undefined}
      inert={inert}
    >
      <PageTitle page={book.title} />
      <div className="lp-backdrop" />
      <TopNav />
      {failed ? (
        <FailedOverlay />
      ) : (
        !ready && (
          <Loading
            kind="stage"
            mark="line"
            className="lp-overlay"
            testId="listen-preparing"
            title="Preparing your audiobook…"
            label="This may take a moment on first listen"
          />
        )
      )}
      <Stage book={book} />
    </div>
  );
}

/** The full-screen audiobook player at `/listen/:uuid`; `?file_id` picks one of a book's audio files. */
export function Listen() {
  const uuid = parseBookUuid(useParams().uuid);
  const fileId = positiveInt(useSearchParams()[0].get("file_id"));
  const { open, uuid: playing, book } = usePlayback();
  useEffect(() => {
    if (uuid) open(uuid, fileId);
  }, [uuid, fileId, open]);

  if (!uuid) return <PageNotFound subject="Audiobook" />;
  // Until the effect has retargeted the player, it still holds the last book.
  if (playing !== uuid) return <Opening />;
  switch (book.status) {
    case "error":
      return <PageError message={book.message} />;
    case "missing":
      return <PageNotFound subject="Audiobook" />;
    case "ready":
      return (
        <SearchPaletteProvider>
          <Frame book={book.book} />
          <SearchPaletteOverlay />
        </SearchPaletteProvider>
      );
    default:
      return <Opening />;
  }
}

function Opening() {
  return (
    <Loading
      kind="stage"
      mark="line"
      className="in-flow"
      label="Opening the audiobook"
    />
  );
}
