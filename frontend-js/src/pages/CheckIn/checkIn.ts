import type {
  ExternalBookMeta,
  ScanBook,
  ScanOutcome,
  WishlistAddRequest,
} from "../../api";

// The check-in flow's pure logic: where it is, what each outcome opens, and the copy that words it.

/** How the reader reached the book the flow holds; it words the match screens and a wishlist entry's source. */
export type FoundVia = "isbn" | "scan" | "search";

/** Where the flow sits: one variant per leaf of the decision tree, plus the transient states. */
export type Stage =
  | { kind: "lookup" }
  | { kind: "scan" }
  /** The keypad, reached from the scanner when asked for or when the camera won't start. */
  | { kind: "entry" }
  | { kind: "resolving" }
  | {
      kind: "confirm";
      book: ScanBook;
      isbn: string;
      wishlisted: boolean;
      via: FoundVia;
    }
  | {
      kind: "closeMatch";
      books: ScanBook[];
      scanned: ExternalBookMeta;
      via: FoundVia;
    }
  | { kind: "choose"; online: ExternalBookMeta; via: FoundVia }
  /** Picking the library book a copy belongs to; `origin` is the screen Back returns to. */
  | { kind: "link"; isbn: string; origin: Stage; via: FoundVia }
  | { kind: "unresolved"; isbn: string; via: FoundVia }
  | { kind: "checkedIn"; uuid: string; title: string; offWishlist: boolean }
  | { kind: "wishlisted"; title: string };

/** The screen an outcome opens; an `already_owned` one opens the book instead, so the caller handles it first. */
export function stageFor(
  outcome: Exclude<ScanOutcome, { kind: "already_owned" }>,
  isbn: string,
  via: FoundVia,
): Stage {
  switch (outcome.kind) {
    case "on_wishlist":
      return {
        kind: "confirm",
        book: outcome.book,
        isbn,
        wishlisted: true,
        via,
      };
    case "in_library_unowned":
      return {
        kind: "confirm",
        book: outcome.book,
        isbn,
        wishlisted: false,
        via,
      };
    case "close_match":
      // Head and tail on the wire; the picker wants one list.
      return {
        kind: "closeMatch",
        books: [outcome.book, ...(outcome.others ?? [])],
        scanned: outcome.scanned,
        via,
      };
    case "not_in_library":
      return { kind: "choose", online: outcome.online, via };
    case "unresolved":
      return { kind: "unresolved", isbn, via };
    default: {
      const _exhaustive: never = outcome;
      return _exhaustive;
    }
  }
}

/** An ISBN without the separators barcodes and back covers print, `X` upper-cased. */
export const cleanIsbn = (raw: string) =>
  raw.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();

/** Why `cleaned` is not an ISBN-10 or ISBN-13, check digit included, or `null` when it is; the server's validator in the server's words. */
export function isbnRejection(cleaned: string): string | null {
  if (cleaned.length !== 10 && cleaned.length !== 13) {
    return "Enter a 10- or 13-digit ISBN.";
  }
  // ISBN-10's check digit is the only place an X belongs.
  const digits = [...cleaned].map((c, i) =>
    /\d/.test(c)
      ? Number(c)
      : c === "X" && cleaned.length === 10 && i === 9
        ? 10
        : null,
  );
  if (digits.some((d) => d === null)) return "ISBN contains invalid characters";
  const sum =
    cleaned.length === 10
      ? digits.reduce<number>((s, d, i) => s + (d ?? 0) * (10 - i), 0)
      : digits.reduce<number>((s, d, i) => s + (d ?? 0) * (i % 2 ? 3 : 1), 0);
  return sum % (cleaned.length === 10 ? 11 : 10) === 0
    ? null
    : "ISBN has an invalid check digit";
}

/** The line naming the ISBN the flow is working with, by the door it came through. */
export function foundViaLine(via: FoundVia, isbn: string): string {
  if (via === "isbn") return `Entered ISBN ${isbn}`;
  if (via === "scan") return `Scanned ISBN ${isbn}`;
  return `ISBN ${isbn}, from the edition you picked`;
}

/** The provenance of a wishlist entry added down this path. */
export const wishlistSource = {
  isbn: "manual",
  scan: "scan",
  search: "search",
} satisfies Record<FoundVia, WishlistAddRequest["source"]>;

/** The confirm screen's framing of what the copy is added to, worded from the book's holdings. */
export function confirmSubtitle(book: ScanBook, wishlisted: boolean): string {
  if (wishlisted) {
    return "This one is on your wishlist — checking your copy in takes it off.";
  }
  if (book.has_files) {
    return "You already have this one digitally — this adds your print copy.";
  }
  return book.has_physical
    ? "You already have a print copy of this one — this adds another."
    : "This one is in your library without a file — this adds your print copy.";
}

/** The close-match screen's four strings, by whether it offers one candidate or several and how the ISBN was reached. */
export function closeMatchCopy(many: boolean, via: FoundVia) {
  const subject = {
    isbn: "The ISBN you entered",
    scan: "The ISBN you scanned",
    search: "That edition's ISBN",
  }[via];
  const subtitle = `${subject} isn't on any book in your library, but the title and author match ${many ? "these" : "this one"}.`;
  return many
    ? {
        heading: "Which one is this?",
        subtitle,
        pick: "This one",
        decline: "None of these",
      }
    : {
        heading: "Is this the book?",
        subtitle,
        pick: "Yes, that's it",
        decline: "No, different book",
      };
}

/** Names joined for display: "A", "A and B", "A, B and C". */
export function byline(authors: string[]): string {
  const names = authors.map((a) => a.trim()).filter(Boolean);
  const last = names.pop();
  if (last === undefined) return "";
  return names.length ? `${names.join(", ")} and ${last}` : last;
}

/** The dot-separated facts under a provider card's byline, or `null` when the provider carried none. */
export function metaDetails(meta: ExternalBookMeta): string | null {
  const parts = [
    meta.first_publish_year ? `First published ${meta.first_publish_year}` : "",
    meta.publisher?.trim() ?? "",
    meta.pages && meta.pages > 0 ? `${meta.pages} pages` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

/** `s` trimmed, or `undefined` when nothing is left: the wire shape of the optional edition note. */
export const someIfFilled = (s: string) => s.trim() || undefined;

/** The line under a truncated result list: a broad query hides matches, and saying so keeps the reader from concluding the book isn't there. */
export const truncationNote = (shown: number, total: number) =>
  total > shown
    ? `Showing ${shown} of ${total} matches — add the author or more of the title.`
    : null;

/** Slots in the keypad's progress strip: an ISBN-13, the form every barcode carries. */
export const ISBN_SLOTS = 13;

/** One keypad press applied to the entry: backspace pops the last character, anything else appends up to the cap. */
export function applyKey(current: string, key: string): string {
  const cleaned = cleanIsbn(current);
  if (key === "⌫") return cleaned.slice(0, -1);
  return cleaned.length < ISBN_SLOTS ? cleaned + key : cleaned;
}

/** Where a rejected or failed lookup drops the reader: the screen they typed on, or the keypad after a camera decode. */
export const manualFallback = (origin: Stage): Stage =>
  origin.kind === "lookup" ? { kind: "lookup" } : { kind: "entry" };
