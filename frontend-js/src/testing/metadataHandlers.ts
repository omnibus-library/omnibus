import { HttpResponse, http } from "msw";
import type { EbookMetadata } from "../api/generated/schemas";
import { MetadataOverrides } from "../api/generated/schemas";
import { aWireBook } from "./wire";

// MSW fakes and fixtures for the metadata edit page.

/** A book with everything the edit form shows filled in. */
export function anEditableWireBook(
  overrides: Partial<EbookMetadata> = {},
): EbookMetadata {
  return aWireBook({
    description: "A station at the edge of the map hears something answer.",
    publisher: "Lantern Press",
    language: "en",
    isbn13: "9780134685991",
    isbn10: "0134685997",
    print_pages: 320,
    subjects: ["space opera"],
    genres: ["Science fiction"],
    identifiers: [{ scheme: "ISBN", value: "9780134685991" }],
    creators: [
      { name: "Sora Inkwell", role: null, file_as: "Inkwell, Sora", id: 2 },
    ],
    ...overrides,
  });
}

/**
 * `POST` and `DELETE /api/ebooks/{uuid}/overrides`. Each saved body lands in
 * `saved`, each revert bumps `reverted`; with `refuse` set, a 400 whose plain
 * text is that reason. `gate` holds the write until it resolves.
 */
export function overridesHandlers(
  book: EbookMetadata,
  {
    saved = [],
    reverted = { count: 0 },
    refuse,
    gate,
  }: {
    saved?: MetadataOverrides[];
    reverted?: { count: number };
    refuse?: string;
    gate?: Promise<void>;
  } = {},
) {
  return [
    http.post("/api/ebooks/:uuid/overrides", async ({ request }) => {
      await gate;
      if (refuse) return new HttpResponse(refuse, { status: 400 });
      saved.push(MetadataOverrides.parse(await request.json()));
      return HttpResponse.json(book);
    }),
    http.delete("/api/ebooks/:uuid/overrides", async () => {
      await gate;
      if (refuse) return new HttpResponse(refuse, { status: 400 });
      reverted.count += 1;
      return HttpResponse.json({ ...book, has_override: false });
    }),
  ];
}
