import { useEffect, useState, useSyncExternalStore } from "react";
import {
  ApiError,
  type BookUuid,
  declareSyncPoint,
  fetchCrossFormatResume,
} from "../../api";
import { Button } from "../../components/Button/Button";
import { BusyLabel } from "../../components/Loading/Loading";
import type { Relocate } from "./epubGlue";
import { withReader } from "./epubGlue";

const SYNCING = "Syncing…";

/** Moves the text to the spot the audiobook has reached, once per open; draws nothing. */
export function SyncJumpBanner({ uuid }: { uuid: BookUuid }) {
  useEffect(() => {
    let cancelled = false;
    fetchCrossFormatResume(uuid).then((resume) => {
      const mapped = resume?.candidate;
      if (cancelled || resume?.state !== "candidate" || !resume.follow) return;
      if (!mapped) return;
      // The server-derived CFI is the precise target; the locations-scale percentage is the fallback.
      const { epub_cfi: cfi, fraction, percent } = mapped;
      const pct = fraction != null ? fraction * 100 : percent;
      if (cfi) withReader((glue) => glue.displayCfi(cfi));
      else if (pct != null) {
        withReader((glue) =>
          glue.displayPercentage(Math.min(Math.max(pct, 0), 100)),
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, [uuid]);
  return null;
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
    if (!navigator.onLine) return;
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
