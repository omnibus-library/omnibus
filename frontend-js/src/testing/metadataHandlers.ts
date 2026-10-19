import { HttpResponse, http } from "msw";
import {
  CoverFromUrlBody,
  type EbookMetadata,
  EditionHydrateRequest,
  EditionSearchRequest,
  type EditionSearchResponse,
  MetadataOverrides,
  type ProviderEdition,
  type ProviderInfo,
} from "../api/generated/schemas";
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

/**
 * `POST /api/ebooks/{uuid}/cover` (the picked file's name lands in `uploaded`),
 * `POST .../cover/from-url` (the URL lands in `fetched`) and `DELETE
 * .../cover`. Each answers with the book as the write leaves it; with
 * `refuse` set, a 400 whose plain text is that reason.
 */
export function coverWriteHandlers(
  book: EbookMetadata,
  {
    uploaded = [],
    fetched = [],
    reverted = { count: 0 },
    refuse,
    gate,
  }: {
    uploaded?: string[];
    fetched?: string[];
    reverted?: { count: number };
    refuse?: string;
    /** Held until it settles, so a story can act while an upload is in flight. */
    gate?: Promise<void>;
  } = {},
) {
  let current = book;
  const answer = (changes: Partial<EbookMetadata>) => {
    if (refuse) return new HttpResponse(refuse, { status: 400 });
    current = { ...current, ...changes };
    return HttpResponse.json(current);
  };
  return [
    http.post("/api/ebooks/:uuid/cover", async ({ request }) => {
      await gate;
      const cover = (await request.formData()).get("cover");
      if (!refuse && cover instanceof File) uploaded.push(cover.name);
      return answer({ has_override: true, has_cover_override: true });
    }),
    http.post("/api/ebooks/:uuid/cover/from-url", async ({ request }) => {
      const body = CoverFromUrlBody.parse(await request.json());
      if (!refuse) fetched.push(body.url);
      return answer({ has_override: true, has_cover_override: true });
    }),
    http.delete("/api/ebooks/:uuid/cover", () => {
      if (!refuse) reverted.count += 1;
      return answer({ has_cover_override: false });
    }),
  ];
}

/** One edition a provider returned, as `POST /api/metadata/editions/search` sends it. */
export function aProviderEdition(
  overrides: Partial<ProviderEdition> = {},
): ProviderEdition {
  return {
    source: "open_library",
    provider_ref: "OL1M",
    title: "Aurora Station, Vol. 1",
    authors: ["Sora Inkwell"],
    year: "2021",
    publisher: "Lantern Press",
    isbn13: "9780134685991",
    ...overrides,
  };
}

/** `GET /api/metadata/providers` with one provider that is `configured` or not. */
export function providersHandler(configured: boolean, calls = { count: 0 }) {
  return http.get("/api/metadata/providers", () => {
    calls.count += 1;
    return HttpResponse.json([
      {
        id: "open_library",
        display_name: "Open Library",
        configured,
        requires_key: false,
        capabilities: {
          carries_cover: true,
          carries_genres: false,
          carries_ratings: false,
          search_by_isbn: true,
          search_by_title: true,
        },
      },
    ] satisfies ProviderInfo[]);
  });
}

/**
 * `POST /api/metadata/editions/search` answering `found`. Each request body
 * lands in `searched`; `gate` holds the answer until it resolves.
 */
export function editionSearchHandler(
  found: EditionSearchResponse,
  {
    searched = [],
    gate,
  }: { searched?: EditionSearchRequest[]; gate?: Promise<void> } = {},
) {
  return http.post("/api/metadata/editions/search", async ({ request }) => {
    searched.push(EditionSearchRequest.parse(await request.json()));
    await gate;
    return HttpResponse.json(found);
  });
}

/**
 * `POST /api/metadata/editions/hydrate`, answering by `provider_ref`: the full
 * edition, `null` for a provider that no longer knows it, or "fails" for a 502
 * with a plain-text body. Each ref asked for lands in `hydrated`; a ref's gate
 * holds its answer until it resolves.
 */
export function hydrateHandler(
  answers: Record<string, ProviderEdition | null | "fails">,
  {
    hydrated = [],
    gates = {},
  }: { hydrated?: string[]; gates?: Record<string, Promise<void>> } = {},
) {
  return http.post("/api/metadata/editions/hydrate", async ({ request }) => {
    const { provider_ref } = EditionHydrateRequest.parse(await request.json());
    hydrated.push(provider_ref);
    await gates[provider_ref];
    const answer = answers[provider_ref] ?? null;
    return answer === "fails"
      ? new HttpResponse("provider unavailable", { status: 502 })
      : HttpResponse.json(answer);
  });
}
