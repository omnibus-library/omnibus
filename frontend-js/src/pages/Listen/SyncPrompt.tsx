import { useQuery } from "@tanstack/react-query";
import { SyncOfferCard } from "../../components/SyncOffer/SyncOffer";
import { usePlayback } from "../../playback/PlaybackProvider";
import { meQuery } from "../../session";
import {
  dismissedClock,
  playerOfferCopy,
  playerOfferVisible,
  storeDismissedClock,
} from "../../syncOffer";

/** With follow off, offers the reading position mapped onto the audio; it seeks only on Go. */
export function SyncPrompt() {
  const userId = useQuery(meQuery).data?.id ?? null;
  const {
    uuid,
    syncOffer: offer,
    ready,
    failed,
    loadedFileId,
    seek,
    answerSyncOffer,
  } = usePlayback();
  if (!uuid || !offer || userId === null) return null;
  const visible = playerOfferVisible(
    offer,
    ready,
    failed,
    loadedFileId,
    dismissedClock(userId, uuid, "audio"),
  );
  const copy = playerOfferCopy(offer.seconds, offer.sourceAhead);
  if (!visible || !copy || offer.seconds === null) return null;
  const { seconds, sourceClock } = offer;
  const answer = (go: boolean) => {
    storeDismissedClock(userId, uuid, "audio", sourceClock);
    answerSyncOffer();
    if (go) seek(seconds);
  };
  return (
    <SyncOfferCard
      place="player"
      copy={copy}
      onGo={() => answer(true)}
      onDismiss={() => answer(false)}
    />
  );
}
