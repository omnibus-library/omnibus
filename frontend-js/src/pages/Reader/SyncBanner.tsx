import { useQuery } from "@tanstack/react-query";
import { useEffect, useState, useSyncExternalStore } from "react";
import {
  ApiError,
  type BookUuid,
  type CrossFormatResume,
  declareSyncPoint,
  fetchCrossFormatResume,
} from "../../api";
import { Button } from "../../components/Button/Button";
import { BusyLabel } from "../../components/Loading/Loading";
import { SyncOfferCard } from "../../components/SyncOffer/SyncOffer";
import { meQuery } from "../../session";
import {
  dismissedClock,
  readerOfferCopy,
  shouldOffer,
  storeDismissedClock,
} from "../../syncOffer";
import type { Relocate } from "./epubGlue";
import { withReader } from "./epubGlue";

const SYNCING = "Syncing…";

type Candidate = NonNullable<CrossFormatResume["candidate"]>;

/** Moves the text to the candidate's spot: the server-derived CFI is precise, the locations-scale percentage the fallback. */
function jumpTo({ epub_cfi: cfi, fraction, percent }: Candidate) {
  const pct = fraction != null ? fraction * 100 : percent;
  if (cfi) withReader((glue) => glue.displayCfi(cfi));
  else if (pct != null) {
    withReader((glue) =>
      glue.displayPercentage(Math.min(Math.max(pct, 0), 100)),
    );
  }
}

/**
 * Where the audiobook has the reader, once per open: with follow on the text moves there
 * and nothing draws; with it off a banner offers the jump. `onAnswered` takes focus back,
 * since the clicked button goes with the banner.
 */
export function SyncJumpBanner({
  uuid,
  onAnswered,
}: {
  uuid: BookUuid;
  onAnswered(): void;
}) {
  const userId = useQuery(meQuery).data?.id ?? null;
  const [offer, setOffer] = useState<{
    uuid: BookUuid;
    candidate: Candidate;
  } | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchCrossFormatResume(uuid).then((resume) => {
      const mapped = resume?.candidate;
      if (cancelled || resume?.state !== "candidate" || !mapped) return;
      if (resume.follow) jumpTo(mapped);
      else setOffer({ uuid, candidate: mapped });
    });
    return () => {
      cancelled = true;
    };
  }, [uuid]);

  // Tagged with its book: the page outlives a swap of the route's uuid.
  if (offer?.uuid !== uuid || userId === null) return null;
  const { candidate } = offer;
  const clock = candidate.source_client_updated_at;
  const copy = readerOfferCopy(candidate.percent, candidate.source_ahead);
  if (!copy || !shouldOffer(clock, dismissedClock(userId, uuid, "epub"))) {
    return null;
  }
  const answer = (go: boolean) => {
    storeDismissedClock(userId, uuid, "epub", clock);
    setOffer(null);
    if (go) jumpTo(candidate);
    onAnswered();
  };
  return (
    <SyncOfferCard
      place="reader"
      copy={copy}
      onGo={() => answer(true)}
      onDismiss={() => answer(false)}
    />
  );
}

function subscribeOnline(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/** The footer pill that declares this spot matches the audiobook's; a direct call, never queued offline. */
export function SyncHerePill({
  uuid,
  loc,
}: {
  uuid: BookUuid;
  loc: Pick<Relocate, "cfi" | "frac" | "pctApprox">;
}) {
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine);
  const [label, setLabel] = useState("Synced here");
  const syncing = label === SYNCING;
  // Until the locations pass resolves `frac` is a rounded stand-in; declaring from it would bend every later mapping.
  const precise = !loc.pctApprox && loc.cfi !== null;

  async function declare() {
    setLabel(SYNCING);
    try {
      await declareSyncPoint(uuid, { fraction: loc.frac, cfi: loc.cfi });
      setLabel("Synced ✓");
    } catch (e) {
      setLabel(
        e instanceof ApiError && e.status === 409
          ? "Link formats first"
          : "Sync failed",
      );
    }
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      className="rd-sync-here"
      data-testid="reader-sync-here"
      title="Declare the ebook and audiobook aligned at this spot"
      disabled={!online || !precise || syncing}
      aria-busy={syncing}
      onClick={declare}
    >
      <BusyLabel busy={syncing} label={label} busyLabel={SYNCING} />
    </Button>
  );
}
