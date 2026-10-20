import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  type CleanupKindCounts,
  cleanupCountsQuery,
  cleanupKindLabel,
  detectCleanup,
} from "../../api";
import { Button, ButtonLink } from "../../components/Button/Button";
import { BusyLabel, Loading } from "../../components/Loading/Loading";
import type { Status } from "./StatusLine";

function KindRow({ kind, counts }: CleanupKindCounts) {
  const label = cleanupKindLabel(kind);
  return (
    <li className="cleanup-kind-row" data-testid={`cleanup-kind-${kind}`}>
      <span className="cleanup-kind-label">{label}</span>
      <span
        className="cleanup-kind-count"
        data-testid={`cleanup-count-${kind}`}
      >
        {counts.pending} pending
      </span>
      <ButtonLink
        to={`/admin/cleanup/${kind}`}
        data-testid={`cleanup-review-${kind}`}
        aria-label={`Review ${label.toLowerCase()}`}
      >
        Review
      </ButtonLink>
    </li>
  );
}

/** The cleanup suggestions waiting on a decision, one row per kind, with a way to look for more. */
export function CleanupCard() {
  const queryClient = useQueryClient();
  const counts = useQuery(cleanupCountsQuery);
  const [status, setStatus] = useState<Status | null>(null);
  const detect = useMutation({
    mutationFn: detectCleanup,
    onMutate: () => setStatus(null),
    onSuccess: () => {
      setStatus({
        text: "Detection started. Counts update as it finishes.",
        isError: false,
      });
      void queryClient.invalidateQueries({
        queryKey: cleanupCountsQuery.queryKey,
      });
    },
    onError: (error) =>
      setStatus({
        text: `Couldn’t start detection: ${error.message}`,
        isError: true,
      }),
  });

  return (
    <section className="card" data-testid="cleanup-card">
      <h3>Suggested fixes</h3>
      <p className="subtitle">
        Near-duplicate authors, series, and tags, plus book titles carrying
        filename cruft.
      </p>
      {counts.data === undefined ? (
        counts.isError ? (
          <div className="settings-actions">
            <p
              className="settings-status settings-action-status error"
              role="status"
              data-testid="cleanup-counts-error"
            >
              Couldn’t load the cleanup counts.
            </p>
            <Button
              variant="ghost"
              data-testid="cleanup-counts-retry"
              onClick={() => counts.refetch()}
            >
              Try again
            </Button>
          </div>
        ) : (
          <Loading
            kind="section"
            className="start"
            testId="cleanup-counts-loading"
            label="Counting what needs tidying…"
          />
        )
      ) : (
        <ul className="cleanup-kinds" data-testid="cleanup-kinds">
          {counts.data.map((row) => (
            <KindRow key={row.kind} {...row} />
          ))}
        </ul>
      )}
      <div className="settings-actions cleanup-actions">
        <Button
          data-testid="cleanup-detect"
          disabled={detect.isPending}
          aria-busy={detect.isPending}
          onClick={() => detect.mutate()}
        >
          <BusyLabel
            busy={detect.isPending}
            label="Run detection now"
            busyLabel="Starting…"
          />
        </Button>
      </div>
      {status !== null && (
        <p
          className={
            status.isError ? "settings-status error" : "settings-status"
          }
          role="status"
          data-testid="cleanup-detect-status"
        >
          {status.text}
        </p>
      )}
    </section>
  );
}
