import { HttpResponse, http } from "msw";
import type {
  WishlistBook,
  WishlistHolding,
  WishlistReader,
  WishlistReaders,
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
  piranesi: book("Piranesi", { authors: ["Susanna Clarke"] }),
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

  return { handlers, state, requests, viewer };
}

export type WishlistFake = ReturnType<typeof wishlistFake>;
