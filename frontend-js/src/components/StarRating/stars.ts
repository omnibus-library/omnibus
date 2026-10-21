/**
 * How much of the star in `slot` (1 to 5) `stars` fills, as the percent width
 * its foreground is clipped to: 100, 50 or 0. A value between halves rounds
 * down, since a bar drawn wider than the rating overstates it.
 */
export function fillPercent(stars: number, slot: number): 0 | 50 | 100 {
  if (stars >= slot) return 100;
  return stars >= slot - 0.5 ? 50 : 0;
}

/** A star value without a trailing `.0`: 4.5 stays, 4 reads "4". */
export const fmtStars = (stars: number) => String(Number(stars.toFixed(1)));
