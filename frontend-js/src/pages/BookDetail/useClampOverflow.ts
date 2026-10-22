import { type RefObject, useLayoutEffect, useState } from "react";

/**
 * Whether the clamped element hides text, so a "Read more" is worth offering. It reads
 * the element while `clamped`; once the reader opens it, the answer stays as it was
 * and the button can fold it again.
 */
export function useClampOverflow(
  target: RefObject<HTMLElement | null>,
  clamped: boolean,
  /** What the element shows: a different body needs measuring again. */
  content: unknown,
) {
  const [overflowing, setOverflowing] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `content` is the cue to measure again, not a value the effect reads
  useLayoutEffect(() => {
    const element = target.current;
    if (!clamped || !element) return;
    const measure = () =>
      setOverflowing(element.scrollHeight > element.clientHeight);
    measure();
    // A wider or narrower column wraps the text differently.
    const watch = new ResizeObserver(measure);
    watch.observe(element);
    return () => watch.disconnect();
  }, [target, clamped, content]);
  return overflowing;
}
