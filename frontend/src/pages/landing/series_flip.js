// Series-stack FLIP motion for the landing grid (#2634). Installed once per
// grid element and replayed after every deal-out / fold render. A capture-
// phase listener snapshots each cell's box *before* Dioxus handles the click
// or key that changes the grid, so `play()` — run from a post-render effect —
// can invert every cell from where it was. Skipped under reduced motion.
(() => {
  const grid = document.querySelector('[data-testid="lib-grid"]');
  if (!grid) return;
  if (!grid.__ssFlip) {
    let first = null;
    const reduced = () =>
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const snap = () => {
      first = null;
      if (reduced()) return;
      first = new Map();
      for (const el of grid.querySelectorAll("[data-flip-key]")) {
        first.set(el.dataset.flipKey, el.getBoundingClientRect());
      }
    };
    const trigger = (t) =>
      t instanceof Element && t.closest(".ss-stack, .ss-cap-fold");
    grid.addEventListener("click", (e) => { if (trigger(e.target)) snap(); }, true);
    grid.addEventListener("keydown", (e) => {
      const opens = (e.key === "Enter" || e.key === " ") && trigger(e.target);
      if (e.key === "Escape" || opens) snap();
    }, true);
    // The stack's leaf pose (design `ssPose`, web leaf width .86) inside a
    // cell `w` wide, relative to the cell's top-left.
    const pose = (deck, w) => {
      const pct = 0.86, h = w * 1.5, d = Math.min(deck, 2);
      return {
        x: d * 0.075 * w * pct,
        y: h - h * pct - d * 0.024 * h * pct,
        rot: d * 1.8,
        scale: pct,
        opacity: deck < 3 ? 1 : 0,
      };
    };
    const ease = "cubic-bezier(.22,.9,.24,1)";
    grid.__ssFlip = {
      play() {
        const prev = first;
        first = null;
        if (!prev) return;
        for (const el of grid.querySelectorAll("[data-flip-key]")) {
          const last = el.getBoundingClientRect();
          const was = prev.get(el.dataset.flipKey);
          if (was) {
            const dx = was.left - last.left, dy = was.top - last.top;
            if (dx || dy) {
              el.animate(
                [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }],
                { duration: 560, easing: ease },
              );
            }
            continue;
          }
          const from = el.dataset.flipFrom && prev.get(el.dataset.flipFrom);
          if (from) {
            const deck = Number(el.dataset.flipDeck || 0);
            const p = pose(deck, from.width);
            const dx = from.left - last.left + p.x, dy = from.top - last.top + p.y;
            el.animate(
              [
                { transformOrigin: "0 0", opacity: p.opacity,
                  transform: `translate(${dx}px, ${dy}px) rotate(${p.rot}deg) scale(${p.scale})` },
                { transformOrigin: "0 0", opacity: 1, transform: "none" },
              ],
              { duration: 600, delay: deck * 38, easing: ease, fill: "backwards" },
            );
          } else if (el.classList.contains("ss-cap") || el.classList.contains("ss-cell")) {
            el.animate(
              [{ opacity: 0, transform: "scale(.94)" }, { opacity: 1, transform: "none" }],
              { duration: 380, delay: 140, easing: ease, fill: "backwards" },
            );
          }
        }
      },
    };
  }
  grid.__ssFlip.play();
})();
