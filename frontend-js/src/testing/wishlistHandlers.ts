import { HttpResponse, http } from "msw";
import {
  type ExternalBookMeta,
  PaletteResults,
  ResolveMetaRequest,
  ResolveRequest,
  type ScanBook,
  type ScanOutcome,
  ScanSearchRequest,
  WishlistAddRequest,
  type WishlistBook,
  type WishlistHolding,
  type WishlistReader,
  type WishlistReaders,
} from "../api/generated/schemas";
import { aWireBook, WIRE_ADA } from "./wire";

// A stateful MSW fake of the household wishlist routes, in the shape the server sends them.
// Each reader's entries live in `state`, so a write a story makes shows in the next read.

/** A book the fake knows: what the library holds of it is `files` (per format) and `copies`. */
export type FakeBook = {
  uuid: string;
  title: string;
  authors: string[];
  series?: string;
  index?: string;
  isbn13?: string;
  files?: Record<string, number>;
  copies?: number;
  cover?: boolean;
};

/** One entry on a reader's list, when it was added in Unix seconds. */
export type FakeEntry = { uuid: string; addedAt: number };

const THIS_YEAR = new Date().getUTCFullYear();

/** A moment this year, so the page shows it as a month and day. */
export const thisYear = (month: number, day: number) =>
  Date.UTC(THIS_YEAR, month - 1, day, 9) / 1000;

const book = (title: string, rest: Partial<FakeBook> = {}): FakeBook => ({
  uuid: `uuid-${title.toLowerCase().replaceAll(" ", "-")}`,
  title,
  authors: ["Anon"],
  cover: true,
  ...rest,
});

/** The books the household has between them. */
export const BOOKS = {
  piranesi: book("Piranesi", {
    authors: ["Susanna Clarke"],
    isbn13: "9781635575637",
  }),
  babel: book("Babel", { authors: ["R. F. Kuang"] }),
  hailMary: book("Project Hail Mary", {
    authors: ["Andy Weir"],
    files: { EPUB: 2 },
  }),
  dune: book("Dune", {
    authors: ["Frank Herbert"],
    series: "Dune Chronicles",
    index: "1",
    files: { M4B: 1 },
  }),
  childrenOfTime: book("Children of Time", {
    authors: ["Adrian Tchaikovsky"],
    series: "Children of Time",
    index: "1",
    copies: 1,
  }),
  redRising: book("Red Rising", {
    authors: ["Pierce Brown"],
    series: "Red Rising",
    index: "1",
    files: { EPUB: 3, M4B: 2 },
    copies: 1,
  }),
  hyperion: book("Hyperion", {
    authors: ["Dan Simmons"],
    series: "Hyperion Cantos",
    index: "1",
    cover: false,
  }),
  // Nobody wants it yet: the library holds it, so the add panel can offer it.
  wayOfKings: book("The Way of Kings", {
    authors: ["Brandon Sanderson"],
    series: "The Stormlight Archive",
    index: "1",
    files: { M4B: 1 },
  }),
  allSystemsRed: book("All Systems Red", {
    authors: ["Martha Wells"],
    series: "The Murderbot Diaries",
    index: "1",
    files: { EPUB: 1 },
  }),
} satisfies Record<string, FakeBook>;

/** Who is on the server, the signed-in reader first. */
export const READERS = [
  { id: WIRE_ADA.id, name: "Ada Lovelace", hasAvatar: false },
  { id: 2, name: "Jordan", hasAvatar: false },
  { id: 3, name: "Riley", hasAvatar: false },
  { id: 4, name: "Sam", hasAvatar: false },
];

/** Each reader's entries, as the comps draw them; Sam has none. */
export function startingEntries(): Map<number, FakeEntry[]> {
  const entry = (b: FakeBook, month: number, day: number): FakeEntry => ({
    uuid: b.uuid,
    addedAt: thisYear(month, day),
  });
  return new Map([
    [
      WIRE_ADA.id,
      [
        entry(BOOKS.hyperion, 10, 30),
        entry(BOOKS.allSystemsRed, 10, 22),
        entry(BOOKS.hailMary, 10, 9),
        entry(BOOKS.redRising, 8, 14),
      ],
    ],
    [
      2,
      [
        entry(BOOKS.hailMary, 10, 28),
        entry(BOOKS.piranesi, 10, 24),
        entry(BOOKS.babel, 10, 11),
        entry(BOOKS.childrenOfTime, 9, 30),
        entry(BOOKS.redRising, 9, 12),
      ],
    ],
    [3, [entry(BOOKS.piranesi, 10, 20), entry(BOOKS.dune, 10, 2)]],
    [4, []],
  ]);
}

type Seed = {
  readers?: typeof READERS;
  books?: FakeBook[];
  entries?: Map<number, FakeEntry[]>;
  /** Holds `GET /api/wishlists?user=<user>` until `until` resolves. */
  gate?: { user: string; until: Promise<void> };
  /** What the providers' title search and ISBN lookup know, for the add panel. */
  providers?: ExternalBookMeta[];
};

function holdingsOf(b: FakeBook): WishlistHolding[] {
  const digital = Object.entries(b.files ?? {})
    .sort(([a], [z]) => a.localeCompare(z))
    .map(([format, count]) => ({ format, count }));
  return b.copies
    ? [...digital, { format: "PRINT", count: b.copies }]
    : digital;
}

/** The fake: its `handlers`, and the `state` and `requests` a story reads back. */
export function wishlistFake({
  readers = READERS,
  books = Object.values(BOOKS),
  entries = startingEntries(),
  gate,
  providers = [],
}: Seed = {}) {
  const state = { entries, books: new Map(books.map((b) => [b.uuid, b])) };
  const requests: (string | null)[] = [];
  const nameOf = (id: number) => readers.find((r) => r.id === id)?.name ?? "";
  const viewer = WIRE_ADA.id;

  const wireBook = (
    uuid: string,
    addedAt: number,
    wanters: number[],
  ): WishlistBook | null => {
    const b = state.books.get(uuid);
    if (!b) return null;
    return {
      added_at: addedAt,
      wanted_by: wanters
        .map((id) => ({ id, name: nameOf(id) }))
        .sort((a, z) => a.name.localeCompare(z.name)),
      holdings: holdingsOf(b),
      book: aWireBook({
        id: [...state.books.keys()].indexOf(uuid) + 1,
        unique_identifier: uuid,
        title: b.title,
        filename: `${uuid}.epub`,
        creators: b.authors.map((name) => ({
          name,
          role: null,
          file_as: null,
          id: null,
        })),
        series: b.series ?? null,
        series_index: b.index ?? null,
        isbn13: b.isbn13 ?? null,
        cover_url: b.cover ? `/api/covers/${uuid}` : null,
        formats: Object.keys(b.files ?? {}),
        description: null,
      }),
    };
  };

  /** One reader's list, newest first. */
  const listOf = (id: number) =>
    [...(state.entries.get(id) ?? [])]
      .sort((a, z) => z.addedAt - a.addedAt)
      .flatMap((e) => wireBook(e.uuid, e.addedAt, [id]) ?? []);

  /** Every reader's lists, one row per book, newest add first. */
  const merged = () => {
    const byBook = new Map<string, { addedAt: number; wanters: number[] }>();
    for (const [id, own] of state.entries) {
      for (const e of own) {
        const row = byBook.get(e.uuid) ?? { addedAt: 0, wanters: [] };
        row.addedAt = Math.max(row.addedAt, e.addedAt);
        row.wanters.push(id);
        byBook.set(e.uuid, row);
      }
    }
    return [...byBook]
      .sort(([, a], [, z]) => z.addedAt - a.addedAt)
      .flatMap(([uuid, r]) => wireBook(uuid, r.addedAt, r.wanters) ?? []);
  };

  const readerRows = (): WishlistReaders => {
    const live = (id: number) =>
      (state.entries.get(id) ?? []).filter((e) => state.books.has(e.uuid));
    const rows: WishlistReader[] = readers.map((r) => ({
      id: r.id,
      name: r.name,
      has_avatar: r.hasAvatar,
      is_you: r.id === viewer,
      count: live(r.id).length,
    }));
    const everyone = new Set(
      rows.flatMap((r) => live(r.id).map((e) => e.uuid)),
    );
    return { everyone: everyone.size, readers: rows };
  };

  /** The writes the page made, in order, as `remove` or `add` and the uuid. */
  const writes: { kind: "remove" | "add"; uuid: string }[] = [];
  /** The bodies `POST /api/scan/wishlist` received, in order. */
  const scanWrites: WishlistAddRequest[] = [];
  /** Which routes refuse with a 500, by kind. */
  const refuse: Partial<Record<"remove" | "add" | "scan", boolean>> = {};

  const handlers = [
    http.get("/api/wishlists/readers", () => HttpResponse.json(readerRows())),
    http.get("/api/wishlists", async ({ request }) => {
      const user = new URL(request.url).searchParams.get("user");
      requests.push(user);
      if (gate && gate.user === user) await gate.until;
      if (user === "all") return HttpResponse.json(merged());
      const id = user === null ? viewer : Number(user);
      if (user !== null && !/^[1-9]\d*$/.test(user)) {
        return new HttpResponse("user must be `all` or a reader id", {
          status: 400,
        });
      }
      return readers.some((r) => r.id === id)
        ? HttpResponse.json(listOf(id))
        : new HttpResponse("reader not found", { status: 404 });
    }),
  ];

  /** Whether a removal leaves the book standing: the library holds it, or a reader still wants it. */
  const stands = (uuid: string) => {
    const b = state.books.get(uuid);
    const wanted = [...state.entries.values()].some((own) =>
      own.some((e) => e.uuid === uuid),
    );
    return wanted || (b !== undefined && holdingsOf(b).length > 0);
  };

  const writeHandlers = [
    http.delete("/api/physical/:uuid/wishlist", ({ params }) => {
      const uuid = String(params.uuid);
      writes.push({ kind: "remove", uuid });
      if (refuse.remove) {
        return new HttpResponse("failed with 500", { status: 500 });
      }
      const own = state.entries.get(viewer) ?? [];
      state.entries.set(
        viewer,
        own.filter((e) => e.uuid !== uuid),
      );
      const bookDeleted = !stands(uuid);
      if (bookDeleted) state.books.delete(uuid);
      return HttpResponse.json({ book_deleted: bookDeleted });
    }),
    http.post("/api/physical/:uuid/wishlist", ({ params }) => {
      const uuid = String(params.uuid);
      writes.push({ kind: "add", uuid });
      if (refuse.add) {
        return new HttpResponse("failed with 500", { status: 500 });
      }
      if (!state.books.has(uuid)) {
        return new HttpResponse("book not found", { status: 404 });
      }
      const own = state.entries.get(viewer) ?? [];
      const existing = own.find((e) => e.uuid === uuid);
      const entry = existing ?? {
        uuid,
        addedAt: Math.floor(Date.now() / 1000),
      };
      if (!existing) state.entries.set(viewer, [...own, entry]);
      return HttpResponse.json({
        id: 1,
        user_id: viewer,
        book_uuid: uuid,
        added_at: entry.addedAt,
        source: "detail",
      });
    }),
  ];

  const scanBook = (b: FakeBook): ScanBook => ({
    uuid: b.uuid,
    title: b.title,
    authors: b.authors,
    cover_url: b.cover ? `/api/covers/${b.uuid}` : null,
    has_physical: (b.copies ?? 0) > 0,
    has_files: Object.keys(b.files ?? {}).length > 0,
    isbn: b.isbn13 ?? null,
  });

  /** Where an ISBN lands, as the server's lookup reads it: a library book the reader wants, one held, or a record online. */
  const outcomeFor = (isbn: string, record?: ExternalBookMeta): ScanOutcome => {
    const found = [...state.books.values()].find((b) => b.isbn13 === isbn);
    if (found) {
      const mine = (state.entries.get(viewer) ?? []).some(
        (e) => e.uuid === found.uuid,
      );
      return {
        kind: mine ? "on_wishlist" : "in_library_unowned",
        book: scanBook(found),
      };
    }
    const online = record ?? providers.find((p) => p.isbn13 === isbn);
    return online ? { kind: "not_in_library", online } : { kind: "unresolved" };
  };

  let minted = 0;
  const scanHandlers = [
    http.get("/api/search/palette", ({ request }) => {
      const q = (
        new URL(request.url).searchParams.get("q") ?? ""
      ).toLowerCase();
      // A book held only by a wish has no file and no copy, and the palette hides it.
      const books = [...state.books.values()].filter(
        (b) =>
          holdingsOf(b).length > 0 &&
          `${b.title} ${b.authors.join(" ")}`.toLowerCase().includes(q),
      );
      return HttpResponse.json(
        PaletteResults.parse({
          query: q,
          duration_ms: 1,
          authors: [],
          series: [],
          tags: [],
          book_total: books.length,
          books: books.map((b, i) => ({
            id: i + 1,
            uuid: b.uuid,
            title: b.title,
            author_display: b.authors.join(", "),
            cover_url: b.cover ? `/api/covers/${b.uuid}` : null,
            formats: Object.keys(b.files ?? {}),
            has_physical: (b.copies ?? 0) > 0,
          })),
        }),
      );
    }),
    http.post("/api/scan/search", async ({ request }) => {
      const { query } = ScanSearchRequest.parse(await request.json());
      const q = query.toLowerCase();
      return HttpResponse.json({
        results: providers.filter((p) =>
          `${p.title} ${p.authors.join(" ")}`.toLowerCase().includes(q),
        ),
      });
    }),
    http.post("/api/scan/resolve", async ({ request }) => {
      const { isbn } = ResolveRequest.parse(await request.json());
      return HttpResponse.json(outcomeFor(isbn));
    }),
    http.post("/api/scan/resolve-meta", async ({ request }) => {
      const { meta } = ResolveMetaRequest.parse(await request.json());
      return HttpResponse.json(outcomeFor(meta.isbn13, meta));
    }),
    http.post("/api/scan/wishlist", async ({ request }) => {
      const body = WishlistAddRequest.parse(await request.json());
      scanWrites.push(body);
      if (refuse.scan) {
        return new HttpResponse("failed with 500", { status: 500 });
      }
      // The server mints a fresh book for a provider's record, whatever the library holds.
      let uuid = body.book_uuid ?? "";
      if (!body.book_uuid && body.meta) {
        uuid = `minted-${++minted}`;
        state.books.set(uuid, {
          uuid,
          title: body.meta.title,
          authors: body.meta.authors,
          isbn13: body.meta.isbn13,
        });
      }
      if (!state.books.has(uuid)) {
        return new HttpResponse("book not found", { status: 404 });
      }
      const own = state.entries.get(viewer) ?? [];
      if (!own.some((e) => e.uuid === uuid)) {
        state.entries.set(viewer, [
          ...own,
          { uuid, addedAt: Math.floor(Date.now() / 1000) },
        ]);
      }
      return HttpResponse.json({ book_uuid: uuid });
    }),
  ];

  return {
    handlers: [...handlers, ...writeHandlers, ...scanHandlers],
    state,
    requests,
    writes,
    scanWrites,
    refuse,
    viewer,
  };
}

export type WishlistFake = ReturnType<typeof wishlistFake>;
