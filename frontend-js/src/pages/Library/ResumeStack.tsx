import { useQuery } from "@tanstack/react-query";
import { type CSSProperties, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { fetchRecentProgress, type ResumePoint } from "../../api";
import { CoverImage } from "../../components/Cover/CoverImage";
import {
  BookGlyph,
  PlayGlyph,
  SyncGlyph,
} from "../../components/Glyphs/Glyphs";
import { Skeleton } from "../../components/Loading/Loading";
import { resumeHref, resumeMeta } from "../../resume";

const RESUME_POINTS = 5;
const PAST_STACK_PX = 240;

// Per-card tilt and lift, cycled so a fan of any length keeps the hand-dealt look.
const FAN_ROT = ["-7deg", "-2.5deg", "3deg", "7.5deg", "11deg"];
const FAN_DY = ["0px", "6px", "3px", "10px", "7px"];

/** The words and links a resume point is drawn with. */
function readout(point: ResumePoint) {
  const audio = point.format === "audio";
  const { meta, percent } = resumeMeta(point);
  const progress = audio ? meta : percent === null ? null : `${percent}%`;
  const verb = audio ? "play" : "resume";
  return {
    audio,
    percent,
    title: point.book.title,
    href: resumeHref(point),
    eyebrow: point.linked
      ? "Continue · synced"
      : audio
        ? "Continue listening"
        : "Continue reading",
    whereLine: `${audio ? "Audiobook" : "Ebook"} · ${meta}`,
    byline: [point.book.authors[0], progress].filter(Boolean).join(" · "),
    veilLabel: percent === null ? verb : `${verb} · ${percent}%`,
  };
}

// Every card takes its own book's accent, so the fan reads as different books.
const accentOf = (point: ResumePoint): CSSProperties =>
  point.book.accent ? { "--accent": point.book.accent } : {};

/** The accent the whole page takes: the lead book's, if it has one. */
export const leadAccent = (point: ResumePoint | undefined) =>
  point ? accentOf(point) : undefined;

function FanCard({
  point,
  index,
  isLead,
  onLead,
}: {
  point: ResumePoint;
  index: number;
  isLead: boolean;
  onLead: () => void;
}) {
  const { audio, percent, title, href, eyebrow, veilLabel } = readout(point);
  const { book } = point;
  const style: CSSProperties = {
    ...accentOf(point),
    "--rot": FAN_ROT[index % FAN_ROT.length],
    "--dy": FAN_DY[index % FAN_DY.length],
    "--n": index,
    // Front-to-back paint order, with the lead always on top.
    zIndex: isLead ? 12 : 9 - Math.min(index, 9),
  };
  const cover = <CoverImage book={book} sizes="132px" />;
  if (!isLead) {
    return (
      <button
        type="button"
        className="lmq-fcard"
        style={style}
        title={title}
        aria-label={`Bring ${title} forward`}
        onClick={onLead}
      >
        {cover}
      </button>
    );
  }
  return (
    <Link
      to={href}
      className="lmq-fcard lead"
      style={style}
      title={title}
      aria-label={`${eyebrow}: ${title}`}
    >
      {cover}
      <span className="lmq-veil" aria-hidden="true">
        <span className="lmq-veil-mark">
          {audio ? <PlayGlyph size={16} /> : <BookGlyph size={16} />}
        </span>
        <span className="lmq-veil-lab">{veilLabel}</span>
        {percent !== null && (
          <span className="lmq-veil-bar">
            <i style={{ width: `${percent}%` }} />
          </span>
        )}
      </span>
    </Link>
  );
}

type ResumeStackProps = {
  points: ResumePoint[];
  /** Index of the book in front. */
  lead: number;
  onLead: (key: string) => void;
};

/** Your open books fanned under the lead's name; the front cover resumes, the others come forward. */
export function ResumeStack({ points, lead, onLead }: ResumeStackProps) {
  const front = points[lead];
  if (!front) return null;
  const { title, byline } = readout(front);
  return (
    <section className="lmq-stack" aria-label="Continue reading">
      <div className="lmq-stack-side">
        <Link to={`/books/${front.book.uuid}`} className="lmq-title-link">
          <h2 className="lmq-title">{title}</h2>
        </Link>
        <p className="lmq-by">
          {byline}
          {front.linked && (
            <span className="lmq-synced">
              <SyncGlyph size={12} />
              synced
            </span>
          )}
        </p>
      </div>
      <div className="lmq-fan">
        {points.map((point, index) => (
          <FanCard
            key={point.key}
            point={point}
            index={index}
            isLead={index === lead}
            onLead={() => onLead(point.key)}
          />
        ))}
      </div>
    </section>
  );
}

/** The stack's footprint while the open books are unknown, so nothing below jumps when it lands. */
export function ResumeStackPending() {
  return (
    <section className="lmq-stack lmq-stack-pending" aria-hidden="true">
      <div className="lmq-stack-side">
        <Skeleton
          style={{ "--w": "min(340px,70vw)", height: 30, margin: "0 auto" }}
        />
        <Skeleton style={{ "--w": "140px", margin: "12px auto 0" }} />
      </div>
      <div className="lmq-fan">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="lmq-fcard-pending"
            style={{ "--rot": FAN_ROT[i], "--dy": FAN_DY[i] }}
          >
            <Skeleton shape="cover" index={i} />
          </div>
        ))}
      </div>
    </section>
  );
}

/** Resume once the stack has scrolled away: a ribbon in the page edge that widens when pointed at. */
export function EdgeResume({
  point,
  past,
}: {
  point: ResumePoint;
  past: boolean;
}) {
  const navigate = useNavigate();
  const { audio, title, href, whereLine, veilLabel } = readout(point);
  const { book } = point;
  return (
    // inert while hidden: the ribbon is transparent and offscreen, so its button must not be tabbable.
    <div className="lmq-edge" style={accentOf(point)} inert={!past}>
      <span className="lmq-edge-strip" aria-hidden="true">
        <span className="lmq-edge-vert">{veilLabel}</span>
      </span>
      <span className="lmq-edge-card">
        <span className="ec" aria-hidden="true">
          <CoverImage book={book} sizes="40px" />
        </span>
        <span className="et">
          <b>{title}</b>
          <span>{whereLine}</span>
        </span>
        <button
          type="button"
          className="lmq-edge-go"
          aria-label={`Resume ${title}`}
          onClick={() => navigate(href)}
        >
          {audio ? <PlayGlyph size={11} /> : <BookGlyph size={11} />}
          {audio ? "Play" : "Resume"}
        </button>
      </span>
    </div>
  );
}

/** The books you have open, the one brought forward, and whether the page has scrolled past the stack. */
export function useResumeLead() {
  // A failed feed settles to none, which hides the stack.
  const recent = useQuery({
    queryKey: ["progress", "recent", RESUME_POINTS],
    queryFn: () => fetchRecentProgress(RESUME_POINTS),
  });
  const points = recent.data ?? [];
  // Keyed, so a refetch that reorders the feed keeps the book the reader brought forward.
  const [leadKey, setLeadKey] = useState<string | null>(null);
  const lead = Math.max(
    points.findIndex((point) => point.key === leadKey),
    0,
  );

  // Past this much scroll the stack is off-screen, so the edge ribbon takes over.
  const [past, setPast] = useState(false);
  useEffect(() => {
    const paint = () => setPast(window.scrollY > PAST_STACK_PX);
    paint();
    window.addEventListener("scroll", paint, { passive: true });
    return () => window.removeEventListener("scroll", paint);
  }, []);
  return {
    points,
    lead,
    leadPoint: points[lead],
    pending: recent.isPending,
    setLeadKey,
    past,
  };
}
