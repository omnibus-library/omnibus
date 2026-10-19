import type {
  MetaForm,
  ProviderEdition,
  ProviderSearchSource,
} from "../../api";
import { labelToId } from "./MetaFields";

/** A cooldown as a reader would say it: rounded up, and never "0s". */
export const humanWait = (secs: number) =>
  secs <= 90 ? `${Math.max(secs, 1)}s` : `${Math.ceil(secs / 60)}m`;

/** What one source contributed, in as few words as the distinction allows, and whether it reads as a problem. */
export function sourceStatusText({ status }: ProviderSearchSource): {
  text: string;
  problem: boolean;
  detail: string;
} {
  switch (status.kind) {
    case "answered":
      return {
        text: status.count === 0 ? "nothing" : String(status.count),
        problem: false,
        detail: "",
      };
    case "not_configured":
      return { text: "not set up", problem: false, detail: "" };
    case "failed":
      return { text: "unavailable", problem: true, detail: status.message };
    case "throttled":
      // Worded as what we are doing: a keyless Google Books refuses until its daily quota resets, however long anyone waits.
      return {
        text: `rate limited, skipping for ${humanWait(status.retry_after_secs)}`,
        problem: true,
        detail:
          "This source rate-limited us recently; it is being left alone until the cooldown ends.",
      };
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

/** A field a source can offer and the form can take; `key` is where a copy lands. */
export type MetadataField = {
  label: string;
  /** For the row's `data-testid`s: the form's own id for the label, without its prefix. */
  slug: string;
  key: Exclude<keyof MetaForm, "tags">;
  /** What the source offers: text, or a list for `authors` and `genres`. Blank when it offers nothing. */
  offer: (edition: ProviderEdition) => string | string[];
};

const field = (
  label: string,
  key: MetadataField["key"],
  offer: MetadataField["offer"],
): MetadataField => ({ label, slug: labelToId(label).slice(3), key, offer });

const nonBlank = (values: string[]) =>
  values.map((v) => v.trim()).filter(Boolean);

const text = (value: string | null | undefined) => value?.trim() ?? "";

// Tags are left out on purpose: overwriting the EPUB's own subjects with a provider's vocabulary would destroy them.
/** Every copyable field, in the order the compare screen lists them. */
export const FIELDS: MetadataField[] = [
  field("Title", "title", (e) => text(e.title)),
  field("Author(s)", "authors", (e) => nonBlank(e.authors)),
  field("Publisher", "publisher", (e) => text(e.publisher)),
  field("Published", "published", (e) => text(e.year)),
  field("Series", "series", (e) => text(e.series)),
  field("Book #", "seriesIndex", (e) => text(e.series_index)),
  field("ISBN-13", "isbn13", (e) => text(e.isbn13)),
  field("ISBN-10", "isbn10", (e) => text(e.isbn10)),
  field("Print Pages", "printPages", (e) => e.pages?.toString() ?? ""),
  field("Genres", "genres", (e) => nonBlank(e.genres ?? [])),
  field("Description", "description", (e) => text(e.description)),
];

const show = (value: string | string[]) =>
  typeof value === "string" ? value : nonBlank(value).join(", ");

/** The source's value as the row shows it; blank when the source has none. */
export const sourceValue = (f: MetadataField, edition: ProviderEdition) =>
  show(f.offer(edition));

/** What the form holds for the field, as the row shows it. */
export const currentValue = (f: MetadataField, values: MetaForm) =>
  show(values[f.key]);

/** Whether the source would change the field: a field it has no value for is not a difference, as it can't be copied. */
export const differs = (
  f: MetadataField,
  values: MetaForm,
  edition: ProviderEdition,
) => {
  const source = sourceValue(f, edition).trim();
  return source !== "" && source !== currentValue(f, values);
};

/** Whether the field carries a change from `baseline`, however it got there. */
export const isStaged = (
  f: MetadataField,
  values: MetaForm,
  baseline: MetaForm,
) => currentValue(f, values) !== currentValue(f, baseline);

/** What copying the field writes into the form, or `undefined` when the source has nothing, so a gap never blanks a value. */
export function applyField(f: MetadataField, edition: ProviderEdition) {
  const offered = f.offer(edition);
  return show(offered).trim() === "" ? undefined : offered;
}
