import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type Alignment, type BookUuid, setFollow } from "../../api";
import { nowSecs, recency } from "../../format";
import { alignmentQuery } from "./queries";
import { linkedAudioAt } from "./readout";

type Link = NonNullable<Alignment["link"]>;

const FOLLOW_TITLE =
  "Following jumps to the spot the other format reached. Off keeps the alignment you confirmed and stops the jumps — Unlink is what discards it.";

// Off keeps the confirmed alignment; it is not an unlink.
function FollowSwitch({ uuid, follow }: { uuid: BookUuid; follow: boolean }) {
  const client = useQueryClient();
  const { queryKey } = alignmentQuery(uuid);
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => setFollow(uuid, enabled),
    onSuccess: (_done, enabled) => {
      // Show what the server took even if the refetch below fails.
      client.setQueryData<Alignment>(queryKey, (old) =>
        old?.link ? { ...old, link: { ...old.link, follow: enabled } } : old,
      );
      void client.invalidateQueries({ queryKey });
    },
  });
  return (
    <>
      <button
        type="button"
        className="bdmq-synclink bdmq-followtoggle"
        role="switch"
        aria-checked={follow}
        aria-label="Follow the other format"
        title={FOLLOW_TITLE}
        data-testid="sync-follow-toggle"
        disabled={toggle.isPending}
        onClick={() => toggle.mutate(!follow)}
      >
        {follow ? "following" : "not following"}
      </button>
      {toggle.isError && (
        <span
          className="bdmq-syncerr"
          role="status"
          data-testid="sync-follow-error"
        >
          {toggle.error.message}
        </span>
      )}
    </>
  );
}

function Linked({
  uuid,
  alignment,
  link,
}: {
  uuid: BookUuid;
  alignment: Alignment;
  link: Link;
}) {
  const at = linkedAudioAt(alignment);
  const when = recency(nowSecs(), link.confirmedAt);
  return (
    <div className="mono bdmq-syncline">
      ⇄ one spot, both formats{at && ` — audio at ${at}`} · confirmed {when}
      <FollowSwitch uuid={uuid} follow={link.follow} />
    </div>
  );
}

/** Where the ebook and audiobook stand: unlinked, linked with a follow switch, or paused because the audio changed. */
export function SyncLine({ uuid }: { uuid: BookUuid }) {
  const query = useQuery(alignmentQuery(uuid));
  const { data: alignment } = query;
  return (
    <section className="bd-sync-panel" data-testid="sync-link-row">
      {alignment === undefined ? (
        query.isError && (
          <div className="mono bdmq-syncline" role="status">
            couldn't load the sync status
            <button
              type="button"
              className="bdmq-synclink"
              data-testid="sync-link-retry"
              onClick={() => query.refetch()}
            >
              Retry
            </button>
          </div>
        )
      ) : !alignment.link ? (
        <div className="mono bdmq-syncline">
          ⇄ positions aren't synced — each format keeps its own spot
        </div>
      ) : alignment.link.stale ? (
        <div className="mono bdmq-syncline bdmq-syncline-warn" role="status">
          ⇄ the audiobook files changed since you linked — sync is paused
        </div>
      ) : (
        <Linked uuid={uuid} alignment={alignment} link={alignment.link} />
      )}
    </section>
  );
}
