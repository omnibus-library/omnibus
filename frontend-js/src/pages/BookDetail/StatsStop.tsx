import { useQuery } from "@tanstack/react-query";
import type { BookDetail, Insights } from "../../api";
import { Loading } from "../../components/Loading/Loading";
import { SessionLog } from "../../components/SessionLog/SessionLog";
import { durationLabel, nowSecs } from "../../format";
import { insightsQuery, progressQuery, useWish } from "./queries";
import { newestPercent } from "./readout";
import {
  avgSitSeconds,
  daysIn,
  sessionsLabel,
  shortDate,
  sparkBuckets,
  sparkSummary,
  timeLeftNote,
} from "./stats";

function NoStats({ children }: { children: string }) {
  return (
    <>
      <div className="bdmq-bigquiet" data-testid="bdmq-no-stats">
        No stats yet.
      </div>
      <p className="bdmq-quiet-body">{children}</p>
    </>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="rx-stat">
      <div className="k">{label}</div>
      <div className="v">{value}</div>
      <div className="s">{sub}</div>
    </div>
  );
}

/** The record: four figures, the pace note, and a strip of the last three weeks. */
function Record({ book, insights }: { book: BookDetail; insights: Insights }) {
  const progress = useQuery(progressQuery(book.uuid));
  const percent = progress.data ? newestPercent(progress.data) : null;
  const note = percent === null ? null : timeLeftNote(insights, percent);
  const audioOnly =
    book.hasAudio && !book.hasEbook && !book.hasComic && !book.hasPdf;
  const spark = sparkBuckets(insights.daily, insights.asOfDay);
  const peak = Math.max(1, ...spark);
  return (
    <>
      <div className="bdmq-stats" data-testid="bdmq-stats">
        <Stat
          label="Started"
          value={shortDate(insights.startedAt)}
          sub={daysIn(nowSecs(), insights.startedAt)}
        />
        <Stat
          label={audioOnly ? "Time listened" : "Time in book"}
          value={durationLabel(insights.secondsTotal)}
          sub={sessionsLabel(insights.sessions)}
        />
        <Stat
          label="Pickups"
          value={String(insights.sessions)}
          sub={`avg sit ${durationLabel(avgSitSeconds(insights))}`}
        />
        <Stat
          label="Longest sit"
          value={durationLabel(insights.longestSeconds)}
          sub={shortDate(insights.longestStartedAt)}
        />
      </div>
      {note && <div className="mono bdmq-statsnote">{note}</div>}
      {/* One labelled image, not 22 bars announced a tick at a time. */}
      <div
        className="rx-spark"
        data-testid="bdmq-spark"
        role="img"
        aria-label={sparkSummary(spark, insights.asOfDay, audioOnly)}
      >
        {spark.map((minutes, day) => (
          <i
            // biome-ignore lint/suspicious/noArrayIndexKey: a fixed-length strip, the position is the day
            key={day}
            className={minutes > 0 ? "on" : undefined}
            style={{
              height: `${Math.min(34, 2 + Math.floor((minutes * 32) / peak))}px`,
            }}
          />
        ))}
      </div>
      <div className="rx-spark-axis" aria-hidden="true">
        <span>3 wk ago</span>
        <span>minutes · by day</span>
        <span>today</span>
      </div>
    </>
  );
}

/** Stop 02: the reader's record in the book and their sittings. */
export function StatsStop({ book }: { book: BookDetail }) {
  const wish = useWish(book);
  // A wish has no reading to tally.
  const insights = useQuery({ ...insightsQuery(book.uuid), enabled: !wish });
  const recorded = insights.data;
  return (
    <>
      <div className="bdmq-k">{wish ? "Stats" : "At a glance stats"}</div>
      {wish ? (
        <NoStats>
          Add an ebook or an audiobook to start tracking your reading stats for
          this book.
        </NoStats>
      ) : insights.isPending ? (
        <Loading
          kind="section"
          className="start"
          label="Tallying your reading"
        />
      ) : recorded ? (
        <>
          <Record book={book} insights={recorded} />
          <div className="bdmq-k bdmq-logk">Your sessions</div>
          <SessionLog uuid={book.uuid} />
        </>
      ) : insights.isError ? (
        <>
          <p className="bdmq-quiet-body" role="alert">
            Couldn't load your reading record
            <button
              type="button"
              className="bdmq-synclink"
              onClick={() => insights.refetch()}
            >
              Retry
            </button>
          </p>
          <div className="bdmq-k bdmq-logk">Your sessions</div>
          <SessionLog uuid={book.uuid} />
        </>
      ) : (
        // No sitting yet: nothing to tally.
        <NoStats>
          Open the book and the record starts itself — time, pickups, and pace
          all land here.
        </NoStats>
      )}
    </>
  );
}
