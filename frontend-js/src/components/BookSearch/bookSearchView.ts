import {
  type ExternalBookMeta,
  PROVIDERS,
  type ScanBook,
  type ScanOutcome,
} from "../../api";

/** What an ISBN lookup puts under "In your library" and under the providers' name. */
export function isbnResults(outcome: ScanOutcome): {
  library: ScanBook[];
  online: ExternalBookMeta[];
} {
  switch (outcome.kind) {
    case "already_owned":
    case "on_wishlist":
    case "in_library_unowned":
      return { library: [outcome.book], online: [] };
    case "close_match":
      return {
        library: [outcome.book, ...(outcome.others ?? [])],
        online: [outcome.scanned],
      };
    case "not_in_library":
      return { library: [], online: [outcome.online] };
    case "unresolved":
      return { library: [], online: [] };
    default: {
      const _exhaustive: never = outcome;
      return _exhaustive;
    }
  }
}

/** The library book an outcome matched, so a provider's record goes onto its list and is never minted as a second book. A different edition of the same work is the same book, so a close match counts. */
export function existingBook(outcome: ScanOutcome): ScanBook | null {
  switch (outcome.kind) {
    case "already_owned":
    case "on_wishlist":
    case "in_library_unowned":
    case "close_match":
      return outcome.book;
    case "not_in_library":
    case "unresolved":
      return null;
    default: {
      const _exhaustive: never = outcome;
      return _exhaustive;
    }
  }
}

/** The heading over the providers' results: the provider or providers that answered. */
export function onlineHeading(online: readonly ExternalBookMeta[]) {
  const names = [...new Set(online.map((meta) => PROVIDERS[meta.source].name))];
  return names.length > 0
    ? `From ${names.join(" and ")}`
    : "From online providers";
}
