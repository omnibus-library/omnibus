import {
  type EditionSearchRequest,
  editionRequest,
  type MetaForm,
  type ProviderEdition,
} from "../../api";
import {
  currentValue,
  differs,
  FIELDS,
  type MetadataField,
  sourceValue,
} from "./editionFields";

/**
 * The search a "Title or ISBN" query asks: by ISBN when it reads as ten or thirteen
 * digits (hyphens and spaces allowed), else by title with the book's author. `null` when blank.
 */
export function fetchRequest(
  query: string,
  author: string,
): EditionSearchRequest | null {
  const text = query.trim();
  if (!text) return null;
  const digits = text.replace(/[\s-]/g, "");
  return /^(\d{13}|\d{9}[\dXx])$/.test(digits)
    ? editionRequest("", "", digits)
    : editionRequest(text, author, "");
}

/** The first edition each provider returned, in the order given: the best match from every source. */
export function onePerProvider(editions: ProviderEdition[]): ProviderEdition[] {
  const seen = new Set<ProviderEdition["source"]>();
  return editions.filter(({ source }) => {
    if (seen.has(source)) return false;
    seen.add(source);
    return true;
  });
}

/** One field the edition would change: what the form holds, what it offers, and whether applying should start on. */
export type DiffRow = {
  field: MetadataField;
  before: string;
  after: string;
  /** A field the edition fills starts checked; one it overwrites does not. */
  checked: boolean;
};

/** The fields the edition would change, measured against what the form holds now. */
export function diffRows(
  values: MetaForm,
  edition: ProviderEdition,
): DiffRow[] {
  return FIELDS.filter((f) => differs(f, values, edition)).map((field) => {
    const before = currentValue(field, values);
    return {
      field,
      before,
      after: sourceValue(field, edition),
      checked: before.trim() === "",
    };
  });
}
