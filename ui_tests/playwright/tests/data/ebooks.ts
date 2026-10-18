/** One book in `GET /api/rpc/ebooks`, trimmed to what the specs read. */
export type LibraryBook = {
  title: string | null;
  unique_identifier: string | null;
  formats: string[];
};

/** An EPUB uploaded for a delete test, and the folder it was filed under. */
export type UploadedEbook = { uuid: string; folder: string };

// Dates as the landing table and the detail page print them.

/** One book in `GET /api/rpc/ebooks`, with the instant it entered the library. */
export type AddedBook = LibraryBook & { added_at: string | null };

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** The suffix of an English ordinal day, as `ordinal_suffix` in `format.rs`. */
function ordinalSuffix(day: number): string {
  if (day % 100 >= 11 && day % 100 <= 13) return "th";
  if (day % 10 === 1) return "st";
  if (day % 10 === 2) return "nd";
  if (day % 10 === 3) return "rd";
  return "th";
}

// Calibre's "no publish date" placeholder year and anything before it.
const SENTINEL_YEAR_MAX = 101;

/** `Mon Dth, YYYY` for the instant `epochMs` shifted by `offsetHours`. */
export function addedDateText(epochMs: number, offsetHours: number): string {
  const local = new Date(epochMs + offsetHours * 3_600_000);
  const day = local.getUTCDate();
  return `${MONTH_NAMES[local.getUTCMonth()]} ${day}${ordinalSuffix(day)}, ${local.getUTCFullYear()}`;
}

/** Whether `offsetHours` puts `epochMs` on another calendar day than UTC does. */
export function crossesUtcDay(epochMs: number, offsetHours: number): boolean {
  const shifted = new Date(epochMs + offsetHours * 3_600_000);
  return shifted.getUTCDate() !== new Date(epochMs).getUTCDate();
}

/**
 * The published cell's text for a stored `YYYY[-MM[-DD]]` date, as
 * `format_date_short` in `format.rs` prints it: narrowing with the source, and
 * an em dash for an absent, unparsable or sentinel date.
 */
export function expectedPublishedText(raw: string): string {
  const datePart = raw.trim().split(/[T ]/)[0] ?? "";
  const [yearStr, monthStr, dayStr] = datePart.split("-");
  const year = Number(yearStr);
  if (!yearStr || !Number.isFinite(year) || year <= SENTINEL_YEAR_MAX) {
    return "—";
  }
  const month = monthStr ? Number(monthStr) : undefined;
  const dayNum = dayStr ? Number(dayStr) : undefined;
  // Range-checked, because 0 is a valid Number but not a day.
  const day =
    dayNum !== undefined && dayNum >= 1 && dayNum <= 31 ? dayNum : undefined;
  const monthName =
    month && month >= 1 && month <= 12 ? MONTH_NAMES[month - 1] : undefined;
  if (monthName && day)
    return `${monthName} ${day}${ordinalSuffix(day)}, ${year}`;
  if (monthName) return `${monthName} ${year}`;
  return `${year}`;
}
