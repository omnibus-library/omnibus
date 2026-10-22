import { useEffect, useRef, useState } from "react";
import { coverUrl, type BookDetail as Detail } from "../../api";
import { Cover } from "../../components/Cover/Cover";
import { prefersReducedMotion } from "../../motion";
import { coverShape, leanAngles } from "./lean";

/** The cover on its stage: resting askew, turning toward a fine pointer anywhere over the stage. */
export function HeroCover({ book }: { book: Detail }) {
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
    </div>
  );
}
