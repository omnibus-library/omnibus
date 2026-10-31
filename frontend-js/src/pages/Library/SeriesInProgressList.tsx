import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type CSSProperties, useMemo } from "react";
import { Link } from "react-router";
import {
  hideSeries,
  type SeriesId,
  type SeriesInProgress,
  seriesInProgressQuery,
} from "../../api";
import { ButtonLink } from "../../components/Button/Button";
import { ConfirmDialog } from "../../components/ConfirmModal/ConfirmModal";
import { CoverImage } from "../../components/Cover/CoverImage";
import { Skeleton } from "../../components/Loading/Loading";
import { useToast } from "../../components/Toast/Toast";
import { type SeriesRow, seriesRow } from "./seriesInProgress";
import "./SeriesInProgressList.css";

/** The series the reader is partway through as rows, and whether the list is still being asked for. */
export function useSeriesInProgress() {
  const query = useQuery(seriesInProgressQuery);
  // A failed list settles to none, which hides the panel, as a failed fan does.
  const rows = useMemo(
    () => (query.data ?? []).flatMap((series) => seriesRow(series) ?? []),
    [query.data],
  );
  return { rows, pending: query.isPending };
}

/** Most leaves a row fans; the front one sits highest. */
const LEAF_DEPTH = 3;

function Row({
  row,
  onHide,
}: {
  row: SeriesRow;
  onHide: (series: SeriesInProgress) => void;
}) {
  const { series, next, leaves, action } = row;
  const style: CSSProperties = next.accent ? { "--accent": next.accent } : {};
  return (
    <li className="sip-row" data-testid="sip-row" style={style}>
      <Link
        to={`/series/${series.id}`}
        className="sip-art-link"
        aria-hidden="true"
        tabIndex={-1}
      >
        <span className="ss-art sip-art">
          {leaves.map((leaf, depth) => (
            <span
              key={leaf.uuid}
              className="ss-leaf"
              style={{ "--i": depth, zIndex: LEAF_DEPTH - depth }}
            >
              <CoverImage book={leaf} sizes="56px" />
            </span>
          ))}
        </span>
      </Link>
      <div className="sip-body">
        <Link to={`/series/${series.id}`} className="sip-name">
          {series.name}
        </Link>
        <p className="sip-sub">{row.subtitle}</p>
        <div className="sip-progress">
          <span
            className="sip-segs"
            role="img"
            aria-label={`${row.finished} of ${row.total} finished`}
          >
            {row.segments.map((percent, slot) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: a segment is its volume's slot in series order
              <i key={slot}>
                <b style={{ width: `${percent}%` }} />
              </i>
            ))}
          </span>
          <span className="sip-count">
            {row.finished} of {row.total}
          </span>
        </div>
      </div>
      {next.formats.length > 0 && (
        <ButtonLink
          variant="ghost"
          size="sm"
          to={action.to}
          className="sip-go"
          data-testid="sip-go"
        >
          {action.label}
        </ButtonLink>
      )}
      <button
        type="button"
        className="sip-hide"
        data-testid="sip-hide"
        aria-label={`Hide ${series.name} from home`}
        onClick={() => onHide(series)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </li>
  );
}

/** The series you are partway through, a fanned cover, how far, and a way back in; the ✕ asks to hide one. */
export function SeriesInProgressList({
  rows,
  onHide,
}: {
  rows: SeriesRow[];
  onHide: (series: SeriesInProgress) => void;
}) {
  return (
    <section
      className="sip-panel"
      data-testid="series-in-progress"
      aria-labelledby="sip-heading"
    >
      <h2 className="sip-heading" id="sip-heading">
        Series in progress
      </h2>
      <ul className="sip-list">
        {rows.map((row) => (
          <Row key={row.series.id} row={row} onHide={onHide} />
        ))}
      </ul>
    </section>
  );
}

/** The panel's footprint while the list is unknown, so the hero does not jump when it lands. */
export function SeriesInProgressPending() {
  return (
    <section className="sip-panel sip-panel-pending" aria-hidden="true">
      <Skeleton style={{ "--w": "180px", height: 18 }} />
      <Skeleton style={{ "--w": "100%", height: 64, marginTop: 16 }} />
      <Skeleton style={{ "--w": "100%", height: 64, marginTop: 12 }} />
    </section>
  );
}

/** Asks before keeping `series` off the home page, then does it and drops its row. */
export function HideSeriesDialog({
  series,
  onClose,
}: {
  series: { id: SeriesId; name: string };
  onClose: () => void;
}) {
  const client = useQueryClient();
  const toast = useToast();
  const hide = useMutation({
    mutationFn: () => hideSeries(series.id),
    onSuccess: () => {
      client.setQueryData<SeriesInProgress[]>(
        seriesInProgressQuery.queryKey,
        (rows) => rows?.filter((row) => row.id !== series.id),
      );
      void client.invalidateQueries({ queryKey: ["series", series.id] });
      onClose();
    },
    onError: (error) => {
      toast(`Couldn't hide ${series.name}: ${error.message}`);
      onClose();
    },
  });
  return (
    <ConfirmDialog
      testId="series-hide"
      title={`Hide ${series.name} from home?`}
      body="It stays in your library and comes back here when you start another book in it."
      action="Hide"
      busyLabel="Hiding…"
      busy={hide.isPending}
      onCancel={onClose}
      onConfirm={() => hide.mutate()}
    />
  );
}
