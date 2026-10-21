import { type RefObject, useEffect, useState } from "react";

// A heading that has only just appeared shouldn't claim the rail yet.
const READING_LINE = 120;
const BACK_AFTER = 400;

const reducedMotion = () =>
  matchMedia("(prefers-reduced-motion: reduce)").matches;

function flowParts(stage: HTMLElement | null) {
  const scroller = stage?.querySelector<HTMLElement>(".bdmq-flowscroll");
  if (!stage || !scroller) return null;
  return {
    scroller,
    cover: stage.querySelector<HTMLElement>(".bdmq-coverpx"),
    secs: [...stage.querySelectorAll<HTMLElement>(".bdmq-flowsec")],
  };
}

// Section 0 is the book itself and carries no label, so it scrolls to a true zero.
const sectionTop = (secs: HTMLElement[], i: number) =>
  i === 0 ? 0 : Math.max(0, (secs[i]?.offsetTop ?? 0) - 30);

function measureTopbar() {
  const bar = document.querySelector<HTMLElement>(".atrium-topbar");
  if (bar)
    document.documentElement.style.setProperty(
      "--bdmq-top",
      `${bar.offsetHeight}px`,
    );
}

/**
 * Drives the book stage's continuous flow: the cover drifts with the scroll,
 * `active` is the section the reading line has passed, `backOn` says the top is
 * out of sight, and `goTo` scrolls a section into view.
 */
export function useFlowScroll(stage: RefObject<HTMLElement | null>) {
  const [active, setActive] = useState(0);
  const [backOn, setBackOn] = useState(false);

  useEffect(() => {
    const parts = flowParts(stage.current);
    if (!parts) return;
    const { scroller, cover, secs } = parts;
    const reduced = reducedMotion();
    const paint = () => {
      if (cover) {
        const over = Math.max(0, cover.offsetHeight - scroller.clientHeight);
        // A flow that fits the viewport has nothing to drift over.
        const range = scroller.scrollHeight - scroller.clientHeight;
        const drift = range > 0 ? scroller.scrollTop / range : 0;
        cover.style.transform = `translateY(${reduced ? over / 2 : over / 2 - drift * over}px)`;
      }
      const line = scroller.scrollTop + READING_LINE;
      setActive(
        secs.reduce((at, sec, i) => (sec.offsetTop <= line ? i : at), 0),
      );
      setBackOn(scroller.scrollTop > BACK_AFTER);
    };
    const onResize = () => {
      measureTopbar();
      paint();
    };
    const listeners = new AbortController();
    scroller.addEventListener("scroll", paint, {
      passive: true,
      signal: listeners.signal,
    });
    window.addEventListener("resize", onResize, { signal: listeners.signal });
    measureTopbar();
    scroller.scrollTo({ top: 0, behavior: "auto" });
    paint();
    return () => listeners.abort();
  }, [stage]);

  const goTo = (i: number) => {
    const parts = flowParts(stage.current);
    parts?.scroller.scrollTo({
      top: sectionTop(parts.secs, i),
      behavior: reducedMotion() ? "auto" : "smooth",
    });
  };

  return { active, backOn, goTo };
}
