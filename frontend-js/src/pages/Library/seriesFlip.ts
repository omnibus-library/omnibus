import { prefersReducedMotion } from "../../motion";

/** Every flippable cell's box, by its `data-flip-key`. */
export type Rects = Map<string, DOMRect>;

const EASE = "cubic-bezier(.22,.9,.24,1)";
const flippable = (grid: HTMLElement) =>
  grid.querySelectorAll<HTMLElement>("[data-flip-key]");

/** The grid's cells as they stand, taken before a deal-out or fold; `null` under reduced motion, which skips the animation. */
export function snapshot(grid: HTMLElement): Rects | null {
  if (prefersReducedMotion()) return null;
  return new Map(
    [...flippable(grid)].map((el) => [
      el.dataset.flipKey ?? "",
      el.getBoundingClientRect(),
    ]),
  );
}

// A leaf's pose in a stack cell `width` wide, from its top-left: the fan the volume is dealt out of.
function pose(deck: number, width: number) {
  const fill = 0.86;
  const height = width * 1.5;
  const depth = Math.min(deck, 2);
  return {
    x: depth * 0.075 * width * fill,
    y: height - height * fill - depth * 0.024 * height * fill,
    rotate: depth * 1.8,
    scale: fill,
    opacity: deck < 3 ? 1 : 0,
  };
}

// The cell's entrance CSS animation would fight the one started here.
function cancelCssAnimation(el: HTMLElement) {
  for (const animation of el.getAnimations({ subtree: true })) {
    if (animation instanceof CSSAnimation) animation.cancel();
  }
}

/** Animates each cell from where `first` had it: a moved cell slides, a dealt-out volume fans out of its stack, a new stack or head card fades in. */
export function play(grid: HTMLElement, first: Rects) {
  for (const el of flippable(grid)) {
    const last = el.getBoundingClientRect();
    const was = first.get(el.dataset.flipKey ?? "");
    if (was) {
      const dx = was.left - last.left;
      const dy = was.top - last.top;
      if (dx || dy) {
        cancelCssAnimation(el);
        el.animate(
          [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }],
          { duration: 560, easing: EASE },
        );
      }
      continue;
    }
    const from = first.get(el.dataset.flipFrom ?? "");
    if (from) {
      const deck = Number(el.dataset.flipDeck ?? 0);
      const p = pose(deck, from.width);
      const dx = from.left - last.left + p.x;
      const dy = from.top - last.top + p.y;
      cancelCssAnimation(el);
      el.animate(
        [
          {
            transformOrigin: "0 0",
            opacity: p.opacity,
            transform: `translate(${dx}px, ${dy}px) rotate(${p.rotate}deg) scale(${p.scale})`,
          },
          { transformOrigin: "0 0", opacity: 1, transform: "none" },
        ],
        { duration: 600, delay: deck * 38, easing: EASE, fill: "backwards" },
      );
    } else if (
      el.classList.contains("ss-cap") ||
      el.classList.contains("ss-cell")
    ) {
      cancelCssAnimation(el);
      el.animate(
        [
          { opacity: 0, transform: "scale(.94)" },
          { opacity: 1, transform: "none" },
        ],
        { duration: 380, delay: 140, easing: EASE, fill: "backwards" },
      );
    }
  }
}
