const clamp = (value: number) => Math.max(-1, Math.min(1, value));

/** Degrees the cover turns toward a pointer: ry across (±8), rx down (±6), 0 at its centre. */
export function leanAngles(
  pointer: { x: number; y: number },
  rect: { left: number; top: number; width: number; height: number },
): { rx: number; ry: number } {
  const across = clamp(
    (pointer.x - (rect.left + rect.width / 2)) / (rect.width * 1.6),
  );
  const down = clamp(
    (pointer.y - (rect.top + rect.height / 2)) / (rect.height * 1.2),
  );
  return { rx: 0 - down * 6, ry: across * 8 };
}

/** A cover whose sides are within four percent of each other is a square one (an audiobook's). */
export function coverShape(
  width: number,
  height: number,
): "square" | "portrait" {
  if (width <= 0 || height <= 0) return "portrait";
  return Math.abs(width - height) / Math.max(width, height) <= 0.04
    ? "square"
    : "portrait";
}
