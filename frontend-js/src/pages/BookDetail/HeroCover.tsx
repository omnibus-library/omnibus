import { useEffect, useRef, useState } from "react";
import { coverUrl, type BookDetail as Detail } from "../../api";
import { Cover } from "../../components/Cover/Cover";
import { prefersReducedMotion } from "../../motion";
import { coverShape, leanAngles } from "./lean";

type Piece = {
  kind: "ribbon" | "squiggle" | "diamond";
  tone: "accent" | "deep" | "cream" | "gold";
  at: string;
};

/** Sixteen ribbons, squiggles and diamonds in the cover's colours, scattered around the book. */
const PIECES: Piece[] = [
  { kind: "squiggle", tone: "gold", at: "translate(214 24) rotate(12)" },
  { kind: "ribbon", tone: "accent", at: "translate(262 14) rotate(-24)" },
  { kind: "ribbon", tone: "cream", at: "translate(318 30) rotate(36)" },
  { kind: "squiggle", tone: "accent", at: "translate(352 46) rotate(-18)" },
  { kind: "ribbon", tone: "deep", at: "translate(34 128) rotate(-58)" },
  { kind: "squiggle", tone: "cream", at: "translate(18 222) rotate(84)" },
  { kind: "ribbon", tone: "accent", at: "translate(46 318) rotate(30)" },
  { kind: "diamond", tone: "gold", at: "translate(30 410)" },
  { kind: "ribbon", tone: "cream", at: "translate(394 112) rotate(22)" },
  { kind: "squiggle", tone: "accent", at: "translate(404 204) rotate(-62)" },
  { kind: "ribbon", tone: "gold", at: "translate(392 300) rotate(58)" },
  { kind: "diamond", tone: "deep", at: "translate(400 398)" },
  { kind: "diamond", tone: "accent", at: "translate(70 60)" },
  { kind: "squiggle", tone: "gold", at: "translate(120 452) rotate(20)" },
  { kind: "ribbon", tone: "accent", at: "translate(236 452) rotate(-14)" },
  { kind: "squiggle", tone: "cream", at: "translate(330 456) rotate(-20)" },
];

const SHAPE = {
  ribbon: "M0 0h7v22l-3.5-4L0 22z",
  squiggle: "M0 0c5-7 11-7 14 0s9 7 14 0",
  diamond: "M0 4 4 0 8 4 4 8z",
} as const;

/** The finishing burst: still and hidden until `playing`. */
function Burst({ playing }: { playing: boolean }) {
  return (
    <svg
      className="bp-burst"
      viewBox="0 0 460 514"
      preserveAspectRatio="none"
      data-playing={playing ? "" : undefined}
      aria-hidden="true"
    >
      {PIECES.map(({ kind, tone, at }) => (
        <g key={at} className="bp-piece">
          <path
            d={SHAPE[kind]}
            className={`bp-piece-${kind} is-${tone}`}
            transform={at}
          />
        </g>
      ))}
    </svg>
  );
}

/** The cover on its stage: resting askew, turning toward a fine pointer anywhere over the stage, with a burst of ribbons for a finished book. */
export function HeroCover({
  book,
  playing,
}: {
  book: Detail;
  /** Plays the burst; true for the couple of seconds after the reader finishes the book. */
  playing: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [shape, setShape] = useState<"square" | "portrait">("portrait");
  // The address that failed, so a replaced cover gets its own try.
  const [broken, setBroken] = useState<string | null>(null);
  const src = book.hasCover ? coverUrl(book.uuid) : null;

  useEffect(() => {
    const cover = root.current;
    const stage = cover?.closest<HTMLElement>(".bp-stage");
    if (!cover || !stage) return;
    const finePointer = matchMedia("(hover: hover) and (pointer: fine)");
    const lean = (event: PointerEvent) => {
      if (prefersReducedMotion() || !finePointer.matches) return;
      const { rx, ry } = leanAngles(
        { x: event.clientX, y: event.clientY },
        cover.getBoundingClientRect(),
      );
      cover.style.setProperty("--ry", `${ry.toFixed(2)}deg`);
      cover.style.setProperty("--rx", `${rx.toFixed(2)}deg`);
    };
    const rest = () => {
      cover.style.removeProperty("--ry");
      cover.style.removeProperty("--rx");
    };
    stage.addEventListener("pointermove", lean);
    stage.addEventListener("pointerleave", rest);
    return () => {
      stage.removeEventListener("pointermove", lean);
      stage.removeEventListener("pointerleave", rest);
    };
  }, []);

  return (
    <div ref={root} className="bp-book" data-shape={shape}>
      <div className="bp-tilt">
        <div className="bp-cover-front">
          {src && broken !== src ? (
            <img
              src={src}
              // The shape of a book cover, so the hero holds its height until the image is here.
              width={340}
              height={510}
              alt={`Cover of ${book.title}`}
              onLoad={(event) =>
                setShape(
                  coverShape(
                    event.currentTarget.naturalWidth,
                    event.currentTarget.naturalHeight,
                  ),
                )
              }
              onError={() => setBroken(src)}
            />
          ) : (
            <Cover book={book} src={null} />
          )}
        </div>
      </div>
      <div className="bp-book-shadow" />
      <Burst playing={playing} />
    </div>
  );
}
