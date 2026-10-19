import type { ChartBucket } from "../../api";
import { fixed } from "../../format";
import { monthAbbr } from "../Stats/calendar";

// The plot's labels and geometry, a port of `chart_builder/plot.rs`.

// A key's `i`th dash-separated part as a whole number, `null` when it isn't one.
function part(key: string, i: number): number | null {
  const raw = key.split("-")[i];
  return raw !== undefined && /^\d+$/.test(raw) ? Number(raw) : null;
}

const isMonth = (m: number | null): m is number =>
  m !== null && m >= 1 && m <= 12;

/** A bucket key on the x-axis; a key it can't parse stands for itself rather than taking the page down. */
export function bucketLabel(key: string, bucket: ChartBucket): string {
  switch (bucket) {
    case "year":
      return key;
    case "month": {
      const [year, month] = [part(key, 0), part(key, 1)];
      if (year === null || !isMonth(month)) return key;
      // The year rides along on January, so a multi-year axis doesn't repeat it twelve times.
      return month === 1
        ? `${monthAbbr(month)} ${year % 100}`
        : monthAbbr(month);
    }
    case "day":
    case "week": {
      const [month, day] = [part(key, 1), part(key, 2)];
      return isMonth(month) && day !== null
        ? `${day} ${monthAbbr(month)}`
        : key;
    }
    default: {
      const _exhaustive: never = bucket;
      return _exhaustive;
    }
  }
}

/** The full bucket name for the hover card, which has room for the year the axis label drops. */
export function bucketTitle(key: string, bucket: ChartBucket): string {
  switch (bucket) {
    case "month": {
      const [year, month] = [part(key, 0), part(key, 1)];
      return year !== null && isMonth(month)
        ? `${monthAbbr(month)} ${year}`
        : key;
    }
    case "week":
      return `Week of ${bucketLabel(key, bucket)}`;
    default:
      return bucketLabel(key, bucket);
  }
}

/** A plotted value, for the hover card and the data table. */
export function valueLabel(value: number): string {
  return Math.abs(value % 1) < 0.05 || value >= 100
    ? String(Math.round(value))
    : fixed(value, 1);
}
