import type { StatsSummary } from "../../api";
import { ConfirmModal } from "../../components/ConfirmModal/ConfirmModal";
import { fixed } from "../../format";
import {
  buildHistogramBars,
  cutoverLine,
  glyph,
  histogramCaption,
  METRIC_TITLES,
  measuredLine,
  predatesLedger,
  rateValue,
  ratingTrendCaption,
  type TrendBar,
  trendBars,
  trendTitle,
  unmeasuredLine,
  vsLabel,
} from "./drillIn";
import { type FinishedBook, FinishedCover } from "./FinishedCover";
import { LengthRows } from "./GenreDonut";
import { audioOnly, type Comparison, comparison, type Metric } from "./tiles";

// Spelled out so tools/extract-atrium.cjs sees each class.
const DELTA_CLASS = {
  up: "st-drill-delta up",
  down: "st-drill-delta down",
  flat: "st-drill-delta flat",
} as const satisfies Record<Comparison["direction"], string>;

/** The delta chip, or a plain line when there is nothing to compare (Lifetime, or no rated books). */
function Delta({ delta, vs }: { delta: Comparison | null; vs: string }) {
  if (!delta) {
    return (
      <p className="st-drill-delta-empty" data-testid="stats-drill-delta">
        Not enough data yet to compare.
      </p>
    );
  }
  return (
    <div
      className={DELTA_CLASS[delta.direction]}
      data-testid="stats-drill-delta"
    >
      <span aria-hidden="true">{glyph(delta.direction)}</span> {delta.label}{" "}
      {vs !== "" && <span className="mono st-drill-delta-vs">{vs}</span>}
    </div>
  );
}

/** One normalized column per point with its axis label beneath; the trend and the rating histogram share it, as the histogram is the same widget on a different x-axis. */
function BarStrip({
  bars,
  testId,
  ariaLabel,
}: {
  bars: TrendBar[];
  testId: string;
  ariaLabel: string;
}) {
  const valued = bars.some((bar) => bar.value !== null);
  return (
    <div
      className={
        valued ? "st-drill-trend st-drill-trend-valued" : "st-drill-trend"
      }
      data-testid={testId}
      role="img"
      aria-label={ariaLabel}
    >
      {bars.map((bar, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: columns are positional, and labels repeat across months
          key={`${i}-${bar.label}`}
          className="st-drill-trend-col"
          title={bar.title}
        >
          <div className="st-drill-trend-track">
            <div
              className={
                bar.empty ? "st-drill-trend-slot" : "st-drill-trend-bar"
              }
              data-testid={
                bar.empty ? "stats-drill-bar-empty" : "stats-drill-bar"
              }
              style={bar.empty ? undefined : { height: `${bar.heightPct}%` }}
            >
              {bar.value !== null && (
                <span
                  className="st-drill-trend-value mono"
                  data-testid="stats-drill-bar-value"
                >
                  {bar.value}
                </span>
              )}
            </div>
          </div>
          <div
            className="st-drill-trend-label mono"
            data-testid="stats-drill-bar-label"
          >
            {bar.label}
          </div>
        </div>
      ))}
    </div>
  );
}

/** A chart's heading and, beneath it, the period it covers. */
function SectionHead({
  title,
  caption,
  testId,
}: {
  title: string;
  caption: string;
  testId: string;
}) {
  return (
    <>
      <div className="label st-drill-section-label">{title}</div>
      <p className="st-drill-caption" data-testid={testId}>
        {caption}
      </p>
    </>
  );
}

/** The distribution the mean can't tell: a reader who rates everything 4 from one who splits between 2 and 5. */
function Histogram({ summary }: { summary: StatsSummary }) {
  if (summary.rating_histogram.every((bucket) => bucket.books === 0)) {
    return (
      <p
        className="st-drill-delta-empty"
        data-testid="stats-drill-histogram-empty"
      >
        No ratings in this window yet.
      </p>
    );
  }
  return (
    <>
      <SectionHead
        title="Books at each rating"
        caption={histogramCaption(summary.range)}
        testId="stats-drill-histogram-caption"
      />
      <BarStrip
        bars={buildHistogramBars(summary.rating_histogram)}
        testId="stats-drill-histogram"
        ariaLabel="Star rating distribution"
      />
    </>
  );
}

/** The reading-speed line the tile's total is missing; absent rather than zeroed, since "0 pages an hour" is a claim about how this reader reads. */
function PagesRate({ rate }: { rate: number | null }) {
  if (rate === null) {
    return (
      <p className="st-drill-delta-empty" data-testid="stats-drill-pages-rate">
        No book finished in this window has both a measurable length and
        recorded reading time yet.
      </p>
    );
  }
  return (
    <>
      <div className="label st-drill-section-label">Reading speed</div>
      <p className="st-drill-rate" data-testid="stats-drill-pages-rate">
        <span className="st-drill-rate-value">{rateValue(rate)}</span> est.
        pages an hour
      </p>
      <p className="st-drill-rate-note">
        Estimated from the books you finished in this window and every hour you
        spent reading them. Listening time isn’t counted, so a book you partly
        heard reads faster here than you read it.
      </p>
    </>
  );
}

/** What the window covered, what it could not measure, and the date before which it cannot measure anything: silence about the cutover would let a Lifetime total that excludes years of reading look complete. */
function PagesNote({ summary }: { summary: StatsSummary }) {
  const detail = summary.pages_detail;
  return (
    <div className="st-drill-pages-note" data-testid="stats-drill-pages-note">
      <p className="st-drill-delta-empty">
        {audioOnly(detail)
          ? "Only audiobooks this period — listening turns no pages."
          : summary.pages_read === null
            ? "No page progress recorded in this period yet."
            : measuredLine(detail.measured_books)}
      </p>
      {detail.unmeasured_books > 0 && (
        <p className="st-drill-delta-empty">
          {unmeasuredLine(detail.unmeasured_books, detail.measured_books > 0)}
        </p>
      )}
      {detail.since_day !== null && (
        <p
          className="st-drill-delta-empty"
          data-testid="stats-drill-pages-cutover"
        >
          {cutoverLine(detail.since_day, predatesLedger(detail))}
        </p>
      )}
    </div>
  );
}

function FinishedRow({ book }: { book: FinishedBook }) {
  return (
    <li className="st-drill-finished-row">
      <div className="st-drill-finished-cover">
        <FinishedCover book={book} sizes="40px" />
      </div>
      <div className="st-drill-finished-body">
        <div className="st-drill-finished-title">{book.title}</div>
        {book.author && (
          <div className="mono st-drill-finished-author">{book.author}</div>
        )}
      </div>
      <div className="st-drill-finished-rating mono">
        {typeof book.rating === "number" ? `${fixed(book.rating, 1)} ★` : "—"}
      </div>
    </li>
  );
}

/** The books finished in the window; the server caps the list at its newest completions while `total` is uncapped, so a cut rail says so. */
function FinishedList({ summary }: { summary: StatsSummary }) {
  const books = summary.finished_books;
  if (books.length === 0) {
    return (
      <p className="st-drill-delta-empty">No books finished in this window.</p>
    );
  }
  return (
    <>
      <ul
        className="st-drill-finished-list"
        data-testid="stats-drill-finished-list"
      >
        {books.map((book) => (
          <FinishedRow key={book.book_uuid} book={book} />
        ))}
      </ul>
      {summary.books_finished > books.length && (
        <p className="st-drill-delta-empty">
          Showing the latest {books.length} of {summary.books_finished} finished
          books.
        </p>
      )}
    </>
  );
}

/** The metric's detail sheet: its tile's own delta, its trend, and what the face has no room for. `summary` is the one the sheet was opened on, so the delta names the window it was measured over. */
export function DrillInSheet({
  metric,
  summary,
  onClose,
}: {
  metric: Metric;
  summary: StatsSummary;
  onClose: () => void;
}) {
  const title = METRIC_TITLES[metric];
  const bars = trendBars(metric, summary);
  const trendHeading = trendTitle(metric);
  return (
    <ConfirmModal
      testId="stats-drill-in"
      ariaLabel={`${title} detail`}
      backdropClass="st-drill-scrim"
      dialogClass="st-drill-sheet"
      busy={false}
      focusOnOpen
      onDismiss={onClose}
    >
      <div className="st-drill-grabber" />
      <div className="st-drill-head">
        <h4>{title}</h4>
        <button
          type="button"
          className="st-drill-close"
          data-testid="stats-drill-close"
          aria-label="Close"
          onClick={onClose}
        >
          ✕
        </button>
      </div>
      <div className="st-drill-body">
        <Delta
          delta={comparison(metric, summary)}
          vs={vsLabel(summary.range)}
        />
        {trendHeading !== null && bars.length > 0 && (
          <SectionHead
            title={trendHeading}
            caption={ratingTrendCaption(summary.rating_monthly)}
            testId="stats-drill-trend-caption"
          />
        )}
        {/* An empty series keeps its slot in the sheet's rhythm; the Pages note beneath explains why there are no bars. */}
        {bars.length === 0 ? (
          <div />
        ) : (
          <BarStrip
            bars={bars}
            testId="stats-drill-trend"
            ariaLabel={trendHeading ?? `${title} trend`}
          />
        )}
        {metric === "avg_rating" && <Histogram summary={summary} />}
        {metric === "pages" && (
          <>
            <PagesRate rate={summary.pages_per_hour} />
            <PagesNote summary={summary} />
          </>
        )}
        {metric === "finished" && (
          <>
            <div className="label st-drill-section-label">
              How long they were
            </div>
            <LengthRows summary={summary} />
            <FinishedList summary={summary} />
          </>
        )}
      </div>
    </ConfirmModal>
  );
}
