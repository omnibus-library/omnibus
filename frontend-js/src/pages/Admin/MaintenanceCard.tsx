import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import {
  backfillChapters,
  refetchAuthorPhotos,
  rewriteAllEpubs,
  scanLibrary,
} from "../../api";
import { Button } from "../../components/Button/Button";
import { BusyLabel } from "../../components/Loading/Loading";
import { WorkerStatus } from "../../components/WorkerStatus/WorkerStatus";
import { capitalize } from "../../format";
import { LiveStatus, type Status } from "./StatusLine";

const JOBS = [
  {
    id: "scan-library",
    label: "Scan library",
    description:
      "Look through both library folders now for new, changed and removed books, instead of waiting for the next automatic rescan.",
    noun: "library scan",
    queue: scanLibrary,
  },
  {
    id: "refetch-author-photos",
    label: "Refetch author pictures",
    description:
      "Look up every author’s photo on Open Library again. Pictures set by hand are kept.",
    noun: "author photo refetch",
    queue: refetchAuthorPhotos,
  },
  {
    id: "backfill-chapters",
    label: "Extract audiobook chapters",
    description:
      "Read chapter markers from audiobooks added before chapters were recorded.",
    noun: "chapter extraction",
    queue: backfillChapters,
  },
  {
    id: "rewrite-all-epubs",
    label: "Bake overrides into EPUBs",
    description:
      "Rebuild the downloadable copy of every edited EPUB so downloads and Kobo sync carry your metadata and covers.",
    noun: "EPUB override bake",
    queue: rewriteAllEpubs,
  },
];

function Job({
  job,
  onStatus,
}: {
  job: (typeof JOBS)[number];
  onStatus: (status: Status) => void;
}) {
  const run = useMutation({
    mutationFn: job.queue,
    onSuccess: () =>
      onStatus({ text: `${capitalize(job.noun)} queued.`, isError: false }),
    onError: (error) =>
      onStatus({
        text: `Failed to start ${job.noun}: ${error.message}`,
        isError: true,
      }),
  });
  return (
    <li className="maint-row">
      <p className="maint-desc" id={`${job.id}-desc`}>
        {job.description}
      </p>
      <Button
        variant="ghost"
        disabled={run.isPending}
        aria-busy={run.isPending}
        aria-describedby={`${job.id}-desc`}
        data-testid={job.id}
        onClick={() => run.mutate()}
      >
        <BusyLabel
          busy={run.isPending}
          label={job.label}
          busyLabel="Queuing…"
        />
      </Button>
    </li>
  );
}

/** The one-off jobs the server's background worker runs, with its live progress above them. */
export function MaintenanceCard() {
  const [status, setStatus] = useState<Status | null>(null);
  return (
    <section className="card" data-testid="maintenance-card">
      <h3>Run a job</h3>
      <p className="subtitle">
        Each job runs once on the server’s background worker; progress shows
        here.
      </p>
      <WorkerStatus />
      <ul className="maint-list">
        {JOBS.map((job) => (
          <Job key={job.id} job={job} onStatus={setStatus} />
        ))}
      </ul>
      <LiveStatus
        testId="maintenance-status"
        message={status?.text ?? null}
        isError={status?.isError ?? false}
      />
    </section>
  );
}
