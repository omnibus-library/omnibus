import type { StatsSummary } from "../../api";
import {
  donutGradient,
  foldShares,
  percentages,
  sliceVar,
  untaggedNote,
} from "./donut";

/** The read-versus-listened share of active seconds along the card's foot, drawn as two bars because the ratio is what matters. */
function FormatSplit({ summary }: { summary: StatsSummary }) {
  if (summary.reading_seconds + summary.listening_seconds <= 0) return null;
  const [read = 0, listened = 0] = percentages([
    summary.reading_seconds,
    summary.listening_seconds,
  ]);
  const halves = [
    { label: "Read", percent: read, color: sliceVar(0) },
    { label: "Listened", percent: listened, color: sliceVar(1) },
  ];
  return (
    <div className="st-split" data-testid="stats-format-split">
      {halves.map(({ label, percent, color }) => (
        <div key={label} className="st-split-half">
          <div className="st-split-head">
            <span className="st-split-name">{label}</span>
            {/* Keyed so a changed share fades the number in; the bar animates its width instead. */}
            <span key={percent} className="st-split-pct">
              {percent}%
            </span>
          </div>
          <div className="st-split-track">
            <div
              className="st-split-fill"
              style={{ width: `${percent}%`, background: color }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * "Where the time went": the genre ring and its legend, with the read/listened split beneath.
 * The centre counts the books the slices are drawn from, and the gap to the active books is stated separately.
 */
export function GenreDonut({ summary }: { summary: StatsSummary }) {
  const folded = foldShares(summary.genre_share);
  const tagged = summary.genre_tagged_books;
  const untagged = Math.max(summary.books_active - tagged, 0);
  const percents = percentages(folded.map((share) => share.books));
  const gradient = donutGradient(percents);
  // A new mix remounts the body to replay the content swap; the same data keeps its node.
  const contentKey = JSON.stringify([tagged, untagged, gradient, folded]);
  return (
    <div className="card st-spend" data-testid="stats-genre-donut">
      <div className="label">Where the time went</div>
      {folded.length === 0 ? (
        <p className="st-card-empty">No tagged reading in this period yet.</p>
      ) : (
        <>
          <div key={contentKey} className="st-spend-body">
            <div
              className="st-donut"
              style={{ background: gradient }}
              role="img"
              aria-label="Genre share by book count"
            >
              <div className="st-donut-hole">
                <div className="st-donut-count">{tagged}</div>
                <div className="st-donut-count-label">tagged</div>
              </div>
            </div>
            <ul className="st-donut-legend">
              {folded.map((share, i) => (
                <li
                  // biome-ignore lint/suspicious/noArrayIndexKey: names may collide with the synthetic "Other"
                  key={i}
                  className="st-donut-row"
                >
                  <span
                    className="st-donut-swatch"
                    style={{ background: sliceVar(i) }}
                  />
                  <span className="st-donut-name">{share.name}</span>
                  <span className="st-donut-pct">{percents[i]}%</span>
                </li>
              ))}
            </ul>
          </div>
          {untagged > 0 && (
            <p className="st-card-note" data-testid="stats-donut-untagged">
              {untaggedNote(untagged)}
            </p>
          )}
        </>
      )}
      <FormatSplit summary={summary} />
    </div>
  );
}

/**
 * The "How long they were" rows bucket the finished books by page count, without card chrome because
 * they are the Finished tile's detail. The server chooses the buckets, order and labels, "Unknown" included.
 */
export function LengthRows({ summary }: { summary: StatsSummary }) {
  const buckets = summary.length_buckets;
  if (buckets.reduce((total, bucket) => total + bucket.books, 0) <= 0) {
    return (
      <p className="st-card-empty" data-testid="stats-length-empty">
        No books finished in this period yet.
      </p>
    );
  }
  const percents = percentages(buckets.map((bucket) => bucket.books));
  return (
    <div className="st-length-rows" data-testid="stats-length-split">
      {buckets.map((bucket, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: two server-owned labels could collide
          key={i}
          className="st-split-half"
          data-testid="stats-length-row"
        >
          <div className="st-split-head">
            <span className="st-split-name">{bucket.label}</span>
            {/* The count, not the share, because "3 books" answers what a reader brought to a length chart. */}
            <span key={bucket.books} className="st-split-pct">
              {bucket.books}
            </span>
          </div>
          <div className="st-split-track">
            <div
              className="st-split-fill"
              style={{ width: `${percents[i]}%`, background: sliceVar(i) }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
