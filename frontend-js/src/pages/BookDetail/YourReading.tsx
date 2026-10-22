import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import type { BookDetail, Insights } from "../../api";
import { ChevronDownGlyph } from "../../components/Glyphs/Glyphs";
import { Loading } from "../../components/Loading/Loading";
import { SessionLog } from "../../components/SessionLog/SessionLog";
import { fmtStars } from "../../components/StarRating/stars";
import { UserAvatar } from "../../components/UserAvatar/UserAvatar";
import { nowSecs, spacedDuration } from "../../format";
import {
  alignmentQuery,
  householdQuery,
  insightsQuery,
  progressQuery,
  readStatusQuery,
  reviewsQuery,
  useWish,
} from "./queries";
import { homeReadout, newestPercent, savedStatus } from "./readout";
import {
  calendarDay,
  householdLine,
  lastActivityLabel,
  pacedLeft,
  paceLabel,
  readingStatusLine,
  SPARK_DAYS,
  sessionsLabel,
  sparkBuckets,
  sparkSummary,
} from "./stats";
import "./Overview.css";

type Row = { key: string; label: string; value: string };

/** The fourteen days as bars, one labelled image, with what they add up to. */
function Spark({
  insights,
  audioOnly,
}: {
  insights: Insights;
  audioOnly: boolean;
}) {
  const spark = sparkBuckets(insights.daily, insights.asOfDay);
  const peak = Math.max(1, ...spark);
  const total = spark.reduce((sum, minutes) => sum + minutes, 0);
  return (
    <>
      <p className="bp-spark-head">
        <span>Minutes a day, last {SPARK_DAYS} days</span>
        <span>{spacedDuration(total * 60)}</span>
      </p>
      {/* One labelled image, not fourteen bars announced a tick at a time. */}
      <div
        className="bp-spark"
        data-testid="bp-spark"
        role="img"
        aria-label={sparkSummary(spark, insights.asOfDay, audioOnly)}
      >
        {spark.map((minutes, day) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: a fixed-length strip, the position is the day
            key={day}
            className={minutes > 0 ? undefined : "is-none"}
            style={{ "--m": minutes / peak }}
          />
        ))}
      </div>
      <p className="bp-spark-axis" aria-hidden="true">
        <span>{SPARK_DAYS - 1} days ago</span>
        <span>Today</span>
      </p>
    </>
  );
}

/** The sessions behind the totals, folded away until asked for. */
function Sessions({
  book,
  insights,
  audioOnly,
}: {
  book: BookDetail;
  insights: Insights | null;
  audioOnly: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="bp-sessions"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="bp-link-row">
        {open ? "Hide sessions" : "Show sessions"}
        <ChevronDownGlyph />
      </summary>
      {open && (
        <>
          {insights && <Spark insights={insights} audioOnly={audioOnly} />}
          <SessionLog uuid={book.uuid} />
        </>
      )}
    </details>
  );
}

/** Each other reader's time in the book, who share their stats; nothing while it is unknown or when nobody has opened it. */
function Household({
  book,
  audioOnly,
}: {
  book: BookDetail;
  audioOnly: boolean;
}) {
  const household = useQuery(householdQuery(book.uuid));
  if (household.isPending) {
    return (
      <Loading
        kind="section"
        className="start"
        label="Gathering your household"
      />
    );
  }
  if (!household.data?.length) return null;
  const now = nowSecs();
  return (
    <section className="bp-household" aria-labelledby="bp-household-title">
      <h3 id="bp-household-title">Household</h3>
      {household.data.map((activity) => (
        <div key={activity.reader.id} className="bp-household-reader">
          <UserAvatar
            user={activity.reader}
            className="bp-avatar"
            photoClassName="bp-avatar-photo"
          />
          <div>
            <p className="bp-household-name">{activity.reader.name}</p>
            <p className="bp-household-meta">
              {householdLine(activity, audioOnly)}
            </p>
            <p className="bp-household-meta">
              {audioOnly ? "Last listened" : "Last read"}{" "}
              {calendarDay(now, activity.lastSessionAt)}
            </p>
          </div>
        </div>
      ))}
    </section>
  );
}

/** The reader's record in the book, the sittings behind it and the household's time in it. */
export function YourReading({ book }: { book: BookDetail }) {
  const wish = useWish(book);
  const hasFiles =
    book.hasEbook || book.hasAudio || book.hasComic || book.hasPdf;
  // A wish has no reading to tally.
  const insights = useQuery({ ...insightsQuery(book.uuid), enabled: !wish });
  const progress = useQuery({ ...progressQuery(book.uuid), enabled: hasFiles });
  const alignment = useQuery({
    ...alignmentQuery(book.uuid),
    enabled: hasFiles,
  });
  const recorded = useQuery(readStatusQuery(book.uuid));
  const reviews = useQuery(reviewsQuery(book.uuid));
  const audioOnly =
    book.hasAudio && !book.hasEbook && !book.hasComic && !book.hasPdf;
  const positions = progress.data ?? { reading: null, listening: null };
  const percent = newestPercent(positions);
  const stats = insights.data;
  const status = savedStatus(recorded.data);
  const finishedAt = recorded.data?.finishedAt ?? null;
  const now = nowSecs();
  const verb = audioOnly ? "listened" : "read";

  const statusLine = readingStatusLine({
    status,
    startedAt: stats?.startedAt ?? null,
    finishedAt,
    audioOnly,
  });

  const rows: Row[] = [];
  if (stats) {
    rows.push({
      key: "time",
      label: audioOnly ? "Time listened" : "Time read",
      value: `${spacedDuration(stats.secondsTotal)} over ${sessionsLabel(stats.sessions)}`,
    });
    const pace =
      !audioOnly &&
      percent !== null &&
      paceLabel({ insights: stats, percent, pages: book.pageCount });
    if (pace) rows.push({ key: "pace", label: "Pace", value: pace });
    const updatedAt = Math.max(
      positions.reading?.updatedAt ?? 0,
      positions.listening?.updatedAt ?? 0,
    );
    if (updatedAt > 0) {
      rows.push({
        key: "last",
        label: `Last ${verb}`,
        value: lastActivityLabel(now, updatedAt),
      });
    }
    rows.push({
      key: "longest",
      label: "Longest sitting",
      value: `${spacedDuration(stats.longestSeconds)} on ${calendarDay(now, stats.longestStartedAt)}`,
    });
    if (status === "reading" && percent !== null) {
      const audioLeft = homeReadout(
        alignment.data,
        positions.reading,
      ).audioLeftSecs;
      const paced = pacedLeft(stats, percent);
      if (audioLeft !== null && audioLeft > 0) {
        rows.push({
          key: "left",
          label: "Time left",
          value: spacedDuration(audioLeft),
        });
      } else if (paced !== null) {
        rows.push({
          key: "left",
          label: "Time left",
          value: `About ${spacedDuration(paced)} at your pace`,
        });
      }
    }
  }
  const rated = (reviews.data?.others ?? []).filter((o) => o.stars !== null);
  if (rated.length > 0) {
    rows.push({
      key: "household",
      label: "Household ratings",
      value: rated
        .map((o) => `${o.reader.name} ${fmtStars(o.stars ?? 0)}`)
        .join(", "),
    });
  }

  let body: ReactNode;
  if (wish) {
    body = (
      <p className="bp-reading-note" data-testid="bp-no-stats">
        Add an ebook or an audiobook to start tracking your reading stats for
        this book.
      </p>
    );
  } else if (insights.isPending) {
    body = (
      <Loading kind="section" className="start" label="Tallying your reading" />
    );
  } else if (insights.isError) {
    body = (
      <p className="bp-reading-note" role="alert">
        Couldn’t load your reading record
        <button
          type="button"
          className="bdmq-synclink"
          onClick={() => insights.refetch()}
        >
          Retry
        </button>
      </p>
    );
  } else {
    body = (
      <>
        {statusLine && <p className="bp-reading-status">{statusLine}</p>}
        {rows.length > 0 && (
          <dl className="bp-stats" data-testid="bp-stats">
            {rows.map((row) => (
              <div key={row.key}>
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {!stats && (
          <p className="bp-reading-note">
            {audioOnly
              ? "No listening recorded yet. Time and sessions appear after you start listening."
              : "No reading recorded yet. Time, sessions and pace appear after you open the book."}
          </p>
        )}
      </>
    );
  }

  return (
    <aside className="bp-panel bp-reading" aria-labelledby="bp-reading-title">
      <h2 className="bp-panel-title" id="bp-reading-title">
        Your reading
      </h2>
      {body}
      {!wish && !insights.isPending && (
        <Sessions book={book} insights={stats ?? null} audioOnly={audioOnly} />
      )}
      {!wish && <Household book={book} audioOnly={audioOnly} />}
    </aside>
  );
}
