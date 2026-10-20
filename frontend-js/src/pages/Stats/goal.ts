import { plural } from "../../format";
import { yearFraction } from "./calendar";

type Progress = { current: number; target: number };

/** The ratio as "3 of 24 books", unclamped so a reader past their target sees that they are. */
export const progressCaption = (
  current: number,
  target: number,
  unit: string,
) => `${current} of ${target} ${unit}${plural(target)}`;

/** What is left, or that the goal is met. */
export function remainderCaption(
  current: number,
  target: number,
  unit: string,
): string {
  if (current >= target) return "Goal met";
  const left = target - current;
  return `${left} ${unit}${plural(left)} to go`;
}

/** `aria-valuenow`, which ARIA keeps inside the range; `aria-valuetext` carries the unclamped ratio. */
export const ariaValueNow = (current: number, target: number) =>
  Math.min(Math.max(current, 0), target);

/** Progress as a whole percent clamped to 0 to 100. This is a bar's width, not the ratio. */
export function goalPercent({ current, target }: Progress): number {
  if (target <= 0) return 0;
  return Math.min(Math.max(Math.trunc((current * 100) / target), 0), 100);
}

export const goalMet = ({ current, target }: Progress) => current >= target;

// `Math.round` rounds a half toward +infinity; Rust's `f64::round` rounds it away from zero.
const roundHalfAway = (x: number) => Math.sign(x) * Math.round(Math.abs(x));

/**
 * "3 ahead of pace", "2 behind pace" or "on pace" against an even spread of the target
 * over the year. `null` once the goal is met, or without a server day to measure against.
 */
export function paceNote(goal: Progress, asOfDay: string): string | null {
  const fraction = yearFraction(asOfDay);
  if (goalMet(goal) || fraction === null) return null;
  const gap = roundHalfAway(goal.current - goal.target * fraction);
  if (gap === 0) return "on pace";
  return gap > 0 ? `${gap} ahead of pace` : `${-gap} behind pace`;
}

/**
 * A daily row's label: the noun plus the timeframe the row has to supply itself. With a target it
 * says "a day". Without one it adds no timeframe under a "Today" header, and otherwise says "today".
 */
export function rowLabel(
  noun: string,
  hasTarget: boolean,
  alone: boolean,
): string {
  if (hasTarget) return `${noun} a day`;
  return alone ? noun : `${noun} today`;
}
