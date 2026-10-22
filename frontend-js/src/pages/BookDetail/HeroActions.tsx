import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import type { BookDetail as Detail, WishlistEntry } from "../../api";
import {
  ImmersiveGlyph,
  MergeGlyph,
  MoreGlyph,
  PencilGlyph,
  ShelfGlyph,
  TrashGlyph,
} from "../../components/Glyphs/Glyphs";
import { MoreMenu } from "../../components/MoreMenu/MoreMenu";
import { spacedDuration } from "../../format";
import { useCurrentUser } from "../../session";
import type { BookDialog } from "./BookDialogs";
import { FilePicker, isAudioFile, isReadableFile } from "./FilePicker";
import { FinishCard } from "./FinishCard";
import { WishlistCtas } from "./PhysicalCopies";
import {
  alignmentQuery,
  insightsQuery,
  progressQuery,
  readStatusQuery,
} from "./queries";
import { ReadStatus } from "./ReadStatus";
import {
  chapterSegments,
  continueLabel,
  type HomeReadout,
  homeReadout,
  newestPercent,
  savedStatus,
} from "./readout";
import { pacedLeft } from "./stats";

const NO_FILES =
  "No ebook or audiobook files in your library yet — this title is tracked from your physical collection or wishlist.";

/** The book glyph whose page turns when the button is hovered. */
function PageTurn() {
  return (
    <svg className="bp-page-turn" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 6.5C10.4 5.2 8 4.5 4.5 4.5H3v13.5h1.5c3.5 0 5.9.7 7.5 2" />
      <path d="M12 6.5c1.6-1.3 4-2 7.5-2H21v13.5h-1.5c-3.5 0-5.9.7-7.5 2" />
      <path d="M12 6.5v13.5" />
      <path
        className="bp-leaf"
        d="M12 6.5c1.3-1 3.3-1.6 6-1.7v12.7c-2.7.1-4.7.7-6 1.7"
      />
    </svg>
  );
}

/** Four bars that bounce while the button is hovered or has just been pressed. */
function Equalizer() {
  return (
    <span className="bp-eq" aria-hidden="true">
      <span />
      <span />
      <span />
      <span />
    </span>
  );
}

type ProgressProps = {
  percent: number;
  audioOnly: boolean;
  readout: HomeReadout;
  left: string | null;
  segments: ReturnType<typeof chapterSegments>;
};

/** One segment per chapter with a flag at the position, and what is left to go. */
function Progress({
  percent,
  audioOnly,
  readout,
  left,
  segments,
}: ProgressProps) {
  const { chNow, chTotal, audioAt } = readout;
  const whole = Math.round(percent);
  const valueText =
    chNow && chTotal
      ? `${whole}%, chapter ${chNow.n} of ${chTotal}`
      : left
        ? `${whole}%, ${left}`
        : `${whole}%`;
  return (
    <div className="bp-progress">
      <div
        className="bp-chapter-bar"
        role="progressbar"
        aria-label={audioOnly ? "Listening progress" : "Reading progress"}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={whole}
        aria-valuetext={valueText}
      >
        {segments.map((segment, i) => (
          <span
            // Chapters are positional and never reorder.
            // biome-ignore lint/suspicious/noArrayIndexKey: a chapter has no id of its own
            key={i}
            className={`bp-seg is-${segment.state}`}
            style={{ "--w": segment.weight, "--fill": `${segment.fill}%` }}
          />
        ))}
        <span
          className="bp-chapter-flag"
          style={{ left: `${percent}%` }}
          aria-hidden="true"
        >
          {chNow ? `Ch. ${chNow.n}` : audioAt}
        </span>
      </div>
      <p className="bp-progress-text">
        <strong>{whole}%</strong>
        {left && ` · ${left}`}
      </p>
    </div>
  );
}

/** What the book is, in the one line that stands in for a bar before the reader has started it. */
function runtimeLine(book: Detail, audioSeconds: number): string | null {
  const text = book.hasEbook
    ? "Ebook"
    : book.hasComic
      ? "Comic"
      : book.hasPdf
        ? "PDF"
        : null;
  const parts = [
    text && (book.pageCount ? `${text} · ${book.pageCount} pages` : null),
    book.hasAudio && audioSeconds > 0
      ? `Audiobook · ${spacedDuration(audioSeconds)}`
      : null,
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** The More button's id, where focus lands when the editor sheet closes and its opener has gone. */
export const MORE_BUTTON_ID = "bp-more";

/** The More menu: file the book, edit it, and for admins merge or delete it. */
function MoreActions({
  book,
  onOpenDialog,
}: {
  book: Detail;
  onOpenDialog: (dialog: BookDialog) => void;
}) {
  const { isAdmin } = useCurrentUser();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const hasFiles = book.formats.length > 0;
  return (
    <div className="shd-more">
      <button
        type="button"
        id={MORE_BUTTON_ID}
        className="bp-button bp-button-large bp-button-icon"
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <MoreGlyph />
      </button>
      {open && (
        <MoreMenu
          label="More actions"
          onClose={() => setOpen(false)}
          items={[
            ...(book.hasAudio && book.hasEbook
              ? [
                  {
                    label: "Immersive",
                    testId: "more-immersive",
                    icon: <ImmersiveGlyph size={20} />,
                    onSelect: () => navigate(`/read/${book.uuid}`),
                  },
                ]
              : []),
            {
              label: "Add to shelf",
              testId: "more-shelf",
              icon: <ShelfGlyph />,
              onSelect: () => onOpenDialog("shelf"),
            },
            {
              label: "Edit metadata",
              testId: "more-edit",
              icon: <PencilGlyph size={20} />,
              onSelect: () =>
                navigate(`/books/${book.uuid}/edit`, {
                  state: { fromBook: true },
                }),
            },
            // Merging folds this record's files into another book, so a record with none can't be offered it.
            ...(isAdmin && hasFiles
              ? [
                  {
                    label: "Merge with…",
                    testId: "more-merge",
                    icon: <MergeGlyph />,
                    onSelect: () => onOpenDialog("merge"),
                  },
                ]
              : []),
            // Delete stays on a fileless record: its dialog is that record's only removal.
            ...(isAdmin
              ? [
                  {
                    label: hasFiles ? "Delete files…" : "Delete record…",
                    testId: "more-delete",
                    icon: <TrashGlyph size={20} />,
                    danger: true,
                    onSelect: () => onOpenDialog("delete"),
                  },
                ]
              : []),
          ]}
        />
      )}
    </div>
  );
}

type HeroActionsProps = {
  book: Detail;
  wish: WishlistEntry | null;
  onOpenDialog: (dialog: BookDialog) => void;
  /** Told when the reader picks Finished after another status. */
  onFinish: () => void;
  /** Told when the book is no longer finished: a refused save, or a move back. */
  onUnfinish: () => void;
  /** The finished card rises into place; only for a book finished in this view. */
  celebrating: boolean;
  /** Takes the reader to their rating on the Reviews tab. */
  onLeaveReview: () => void;
};

/** The hero's lower half: how far the reader is, then Continue and Listen, the read status and the More menu. */
export function HeroActions({
  book,
  wish,
  onOpenDialog,
  onFinish,
  onUnfinish,
  celebrating,
  onLeaveReview,
}: HeroActionsProps) {
  const { uuid, hasEbook, hasAudio, hasComic, hasPdf } = book;
  const hasText = hasEbook || hasComic || hasPdf;
  const hasFiles = hasText || hasAudio;
  const audioOnly = hasAudio && !hasText;
  const progress = useQuery({ ...progressQuery(uuid), enabled: hasFiles });
  const alignment = useQuery({ ...alignmentQuery(uuid), enabled: hasFiles });
  const insights = useQuery({ ...insightsQuery(uuid), enabled: hasFiles });
  const recorded = useQuery(readStatusQuery(uuid));
  const positions = progress.data ?? { reading: null, listening: null };
  const readout = homeReadout(alignment.data, positions.reading);
  const percent = newestPercent(positions);
  const pct = Math.min(Math.max(percent ?? 0, 0), 100);
  // The saved status alone: unknown until it is read, and Unread for a book with no record.
  const status = savedStatus(recorded.data);
  useEffect(() => {
    if (status !== "finished") onUnfinish();
  }, [status, onUnfinish]);
  const audioSeconds =
    alignment.data?.audioFiles.reduce((sum, f) => sum + f.seconds, 0) ?? 0;

  // The audio timeline when there is one, else the pace the reader has kept.
  const audioLeft = readout.audioLeftSecs;
  const paced = insights.data ? pacedLeft(insights.data, pct) : null;
  const left =
    audioLeft !== null && audioLeft > 0
      ? `${spacedDuration(audioLeft)} left of ${spacedDuration(audioSeconds)}`
      : paced !== null
        ? `about ${spacedDuration(paced)} left at your pace`
        : null;

  const fill = status === "finished" ? 100 : status === "reading" ? pct : 0;
  const label =
    status === undefined
      ? audioOnly
        ? "Listen"
        : "Read"
      : continueLabel({ audioOnly, status, chapter: readout.chNow?.n ?? null });
  const continueClass = "bp-button bp-button-large bp-continue";
  const body = (icon: ReactNode) => (
    <>
      <span
        className="bp-continue-fill"
        style={{ "--bp-progress": `${fill}%` }}
        aria-hidden="true"
      />
      {icon}
      <span>{label}</span>
    </>
  );

  // Listen's bars keep bouncing for two seconds after a press.
  const [playing, setPlaying] = useState(false);
  const stopPlaying = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(stopPlaying.current), []);
  const press = () => {
    setPlaying(true);
    clearTimeout(stopPlaying.current);
    stopPlaying.current = setTimeout(() => setPlaying(false), 2000);
  };

  const audioFiles = book.bookFiles.filter(isAudioFile);
  const runtime = runtimeLine(book, audioSeconds);
  const barShown =
    hasFiles && status === "reading" && percent !== null && pct > 0;
  return (
    <div className="bp-lower">
      {hasFiles && status === "finished" ? (
        <FinishCard
          book={book}
          finishedAt={recorded.data?.finishedAt ?? null}
          entering={celebrating}
          onLeaveReview={onLeaveReview}
        />
      ) : barShown ? (
        <Progress
          percent={pct}
          audioOnly={audioOnly}
          readout={readout}
          left={left}
          segments={chapterSegments(alignment.data?.chapters ?? null, pct)}
        />
      ) : (
        hasFiles &&
        status !== undefined &&
        runtime && <p className="bp-runtime">{runtime}</p>
      )}
      <div className="bp-actions">
        {wish ? (
          <WishlistCtas book={book} />
        ) : !hasFiles ? (
          <p className="bd-no-files" data-testid="no-files-disclaimer">
            {NO_FILES}
          </p>
        ) : (
          <>
            {hasEbook ? (
              <FilePicker
                uuid={uuid}
                kind="read"
                files={book.bookFiles.filter(isReadableFile)}
                label={body(<PageTurn />)}
                buttonClass={continueClass}
                singleTestId="start-reading"
              />
            ) : hasComic ? (
              <Link
                className={continueClass}
                to={`/comic/${uuid}`}
                data-testid="start-reading-comic"
              >
                {body(<PageTurn />)}
              </Link>
            ) : hasPdf ? (
              <Link
                className={continueClass}
                to={`/pdf/${uuid}`}
                data-testid="start-reading-pdf"
              >
                {body(<PageTurn />)}
              </Link>
            ) : (
              <FilePicker
                uuid={uuid}
                kind="listen"
                files={audioFiles}
                label={body(<Equalizer />)}
                buttonClass={`${continueClass} bp-listen${playing ? " is-playing" : ""}`}
                singleTestId="start-listening"
                onPress={press}
              />
            )}
            {hasAudio && hasText && (
              <FilePicker
                uuid={uuid}
                kind="listen"
                files={audioFiles}
                label={
                  <>
                    <Equalizer />
                    Listen
                  </>
                }
                buttonClass={`bp-button bp-button-large bp-tinted bp-listen${playing ? " is-playing" : ""}`}
                singleTestId="listen-secondary"
                onPress={press}
              />
            )}
          </>
        )}
        <ReadStatus
          uuid={uuid}
          onFinish={onFinish}
          onFinishRefused={onUnfinish}
        />
        <MoreActions book={book} onOpenDialog={onOpenDialog} />
      </div>
    </div>
  );
}
