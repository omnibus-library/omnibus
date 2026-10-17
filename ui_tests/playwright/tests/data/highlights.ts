import { uniqueSuffix } from "./unique";

export type HighlightColor = "amber" | "green" | "blue" | "rose" | "violet";

/** The body of `POST /api/highlights`. */
export type NewHighlight = {
  book_uuid: string;
  epub_cfi_range: string;
  color: HighlightColor;
  text: string;
};

/** A highlight the server stored, with the id it was given. */
export type SeededHighlight = NewHighlight & { id: number };

/**
 * Chars 10 to 24 of the first `<p>` (`/4/4`, after the `<h1>`) in a one-item
 * spine. Mid-paragraph, so its marks move with the text; `overlayDrift`
 * measures the same span.
 */
export const MID_PARAGRAPH_RANGE = "epubcfi(/6/2!/4/4,/1:10,/1:24)";

/** An amber highlight whose quote no other highlight shares. */
export function buildHighlight(
  bookUuid: string,
  overrides: Partial<NewHighlight> = {},
): NewHighlight {
  return {
    book_uuid: bookUuid,
    epub_cfi_range: "epubcfi(/6/4!/4/2,/1:0,/1:40)",
    color: "amber",
    text: `E2E passage ${uniqueSuffix()}`,
    ...overrides,
  };
}
