import type { OfferCopy } from "../../syncOffer";
import { Button } from "../Button/Button";
import "./SyncOffer.css";

export type SyncOfferPlace = "reader" | "player";

// Where the card floats: under the reader's top bar, or over the player's stage.
const PLACE_CLASS = {
  reader: "rd-sync-banner",
  player: "lp-sync-prompt",
} satisfies Record<SyncOfferPlace, string>;

type SyncOfferCardProps = {
  place: SyncOfferPlace;
  copy: OfferCopy;
  onGo(): void;
  onDismiss(): void;
};

/** The follow-off offer: where the other format got to, Go, and a dismiss. */
export function SyncOfferCard({
  place,
  copy,
  onGo,
  onDismiss,
}: SyncOfferCardProps) {
  return (
    <div
      className={`${PLACE_CLASS[place]} card`}
      role="status"
      data-testid="sync-offer"
    >
      <div className="sync-offer-copy">
        <strong>{copy.title}</strong>
        <span>{copy.detail}</span>
      </div>
      <Button size="sm" data-testid="sync-offer-go" onClick={onGo}>
        Go
      </Button>
      <Button
        variant="ghost"
        size="sm"
        data-testid="sync-offer-dismiss"
        aria-label="Dismiss"
        onClick={onDismiss}
      >
        ✕
      </Button>
    </div>
  );
}
