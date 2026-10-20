import type { StatsSummary } from "../../api";
import { durationLabel } from "../../format";
import { remEuclid } from "./calendar";

// The reading clock draws exactly the buckets the server sent and derives nothing from a
// timestamp, so this card and the iOS charts cannot disagree about the same seconds.

type HourBucket = StatsSummary["hour_of_day"][number];
type WeekdayBucket = StatsSummary["day_of_week"][number];

const DEGREES_PER_HOUR = 15;
/** Distance from the dial's centre to the inner end of every tick. It sits just past the inner ring, so the ticks read as a rim. */
const TICK_INSET_PX = 58;
/** How far the busiest hour's tick reaches beyond the inset. */
export const TICK_REACH_PX = 40;
/** The shortest a tick is drawn, so a quiet but nonzero hour is still a mark on the rim. */
export const TICK_MIN_PX = 5;

export type Weight = "hot" | "warm" | "cool" | "idle";

export type Tick = {
  hour: number;
  transform: string;
  heightPx: number;
  weight: Weight;
};

export type Weekday = {
  label: string;
  widthPct: number;
  weight: "hot" | "warm" | "idle";
  readout: string;
};

/** The item with the greatest key, taking the last of equal maxima as `Iterator::max_by_key` does. */
function lastMax<T>(items: readonly T[], key: (item: T) => number) {
  return items.reduce<T | undefined>(
    (best, item) =>
      best === undefined || key(item) >= key(best) ? item : best,
    undefined,
  );
}

const sum = (values: readonly number[]) => values.reduce((a, b) => a + b, 0);

/** The tick's `rotate(…) translateY(…)`, about the dial's centre; hour 0 sits at the top via the half-turn, as the tick grows downward. */
export const tickTransform = (hour: number) =>
  `rotate(${hour * DEGREES_PER_HOUR + 180}deg) translateY(${TICK_INSET_PX}px)`;

/** Four weights, so the rim reads as a shape rather than 24 equal marks; `fraction` is the hour's share of the busiest. */
function weightFor(fraction: number): Weight {
  if (fraction > 0.7) return "hot";
  if (fraction > 0.35) return "warm";
  return fraction > 0.05 ? "cool" : "idle";
}

/** The 24 ticks scaled to the busiest hour; an all-zero window draws 24 floor ticks, which says "no pattern" better than an empty circle. */
export function buildTicks(hours: readonly HourBucket[]): Tick[] {
  const max = Math.max(0, ...hours.map((h) => h.seconds));
  return hours.map((h) => {
    const fraction = max > 0 ? Math.max(h.seconds, 0) / max : 0;
    return {
      hour: h.hour,
      transform: tickTransform(h.hour),
      heightPx: Math.max(Math.round(fraction * TICK_REACH_PX), TICK_MIN_PX),
      weight: weightFor(fraction),
    };
  });
}

/** The hour as a reader's clock shows it, "8pm" or "12am". */
export function hourLabel(hour: number): string {
  const h = remEuclid(hour, 24);
  return `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? "am" : "pm"}`;
}

/** The busiest hour's label, or an em-dash when nothing is placeable, since a row of zeros has no peak rather than one at midnight. */
export function peakHour(hours: readonly HourBucket[]): string {
  const peak = lastMax(
    hours.filter((h) => h.seconds > 0),
    (h) => h.seconds,
  );
  return peak ? hourLabel(peak.hour) : "—";
}

/** The four parts of a day the clock line names, with the copy that introduces each and the hours it covers. */
const BANDS = [
  { lead: "You read early", span: "before noon", from: 5, to: 11 },
  {
    lead: "Afternoons are yours",
    span: "between noon and 5pm",
    from: 12,
    to: 16,
  },
  {
    lead: "Evenings are yours",
    span: "between 5pm and 10pm",
    from: 17,
    to: 21,
  },
  { lead: "You read late", span: "after 10pm", from: 22, to: 4 },
] as const;

/** Seconds recorded inside a band, which may wrap past midnight. */
function bandSeconds(hours: readonly HourBucket[], from: number, to: number) {
  const inBand = (hour: number) =>
    from <= to ? hour >= from && hour <= to : hour >= from || hour <= to;
  return sum(hours.filter((h) => inBand(h.hour)).map((h) => h.seconds));
}

/** Which part of the day the window belongs to and how much of it falls there; `null` when nothing can be placed on a clock. */
export function clockLine(hours: readonly HourBucket[]): string | null {
  const total = sum(hours.map((h) => h.seconds));
  if (total <= 0) return null;
  const band = lastMax(
    BANDS.map((b) => ({ ...b, seconds: bandSeconds(hours, b.from, b.to) })),
    (b) => b.seconds,
  );
  if (!band) return null;
  const pct = Math.trunc((band.seconds * 100) / total);
  return `${band.lead} — ${pct}% of your recorded time lands ${band.span}.`;
}

/** A day's time as "58m", "1h 28m" or "3h", and an em-dash for a day with nothing on it, since a quiet day is an absence, never "0h 0m". */
export const dayReadout = (seconds: number) =>
  seconds <= 0 ? "—" : durationLabel(seconds);

/** The seven weekday rows scaled to the busiest day; labels are the server's, since a client assuming Sunday-first draws every row one place out. */
export function buildWeekdays(days: readonly WeekdayBucket[]): Weekday[] {
  const max = Math.max(0, ...days.map((d) => d.seconds));
  return days.map((d) => ({
    label: d.label,
    widthPct: max > 0 ? Math.trunc((Math.max(d.seconds, 0) * 100) / max) : 0,
    weight: d.seconds <= 0 ? "idle" : d.seconds === max ? "hot" : "warm",
    readout: dayReadout(d.seconds),
  }));
}

/** Activity with no capture-time timezone is stated rather than absorbed, since bucketing it in UTC would put an evening at 4am. */
export const unzonedNote = (seconds: number) =>
  seconds > 0
    ? `${dayReadout(seconds)} of activity was recorded without a timezone and isn’t shown here.`
    : null;
