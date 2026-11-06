import { type HttpHandler, HttpResponse, http } from "msw";
import { isLive } from "../api";
import {
  type BookRequest,
  ChooseVersion,
  type EbookMetadata,
  type RequestListing,
  type RequestVersion,
  StartRequest,
} from "../api/generated/schemas";
import { svg } from "./handlers";
import { aWireBook } from "./wire";

// A stateful MSW fake of the book-request routes, in the shape the server sends them.
// A write a story makes shows in the next read, the lists included; `writes` records them in order.

const NOW = Math.floor(Date.now() / 1000);

/** A version the search found, as the server sends it. */
export function aWireVersion(
  overrides: Partial<RequestVersion> = {},
): RequestVersion {
  return {
    id: 11,
    title: "Hyperion - Dan Simmons EPUB",
    size_bytes: 2_400_000,
    format: "EPUB",
    indexer: "Books",
    seeders: 12,
    protocol: "torrent",
    best_match: false,
    rejected: false,
    ...overrides,
  };
}

/** A request as the server sends it; `looking` and with no versions unless told otherwise. */
export function aWireRequest(
  overrides: Partial<BookRequest> = {},
): BookRequest {
  return {
    id: 7,
    book_uuid: "uuid-hyperion",
    user_id: 1,
    kind: "ebook",
    state: "looking",
    stuck_reason: null,
    stuck_detail: null,
    chosen_result_id: null,
    progress: null,
    expected_done_at: null,
    cancel_at: null,
    cancelled_by: null,
    note: null,
    created_at: NOW,
    updated_at: NOW,
    cover_offer: null,
    versions: [],
    ...overrides,
  };
}

/** The book the fake's requests are for unless told otherwise. */
export const HYPERION = aWireBook({
  title: "Hyperion",
  unique_identifier: "uuid-hyperion",
  creators: [{ name: "Dan Simmons", role: null, file_as: null, id: 3 }],
  formats: [],
});

/** A request as the lists send it: Ada's looking request for Hyperion unless told otherwise. */
export function aWireListing(
  overrides: Partial<RequestListing> = {},
): RequestListing {
  return {
    request: aWireRequest(),
    book: HYPERION,
    requester_name: "Ada Lovelace",
    requester_has_avatar: false,
    cancelled_by_name: null,
    ...overrides,
  };
}

/** What the lists add to a request: its book and the names of who made and who cancelled it; and who is signed in, for a start. */
export type ListingContext = {
  books?: EbookMetadata[];
  names?: Record<number, string>;
  viewer?: number;
};

/** The writes the fake answered, in order. */
export type RequestWrite =
  | { kind: "start"; uuid: string }
  | { kind: "retry"; id: number }
  | { kind: "cancel"; id: number }
  | { kind: "undo"; id: number }
  | { kind: "swap"; id: number }
  | { kind: "choose"; id: number; resultId: number }
  | { kind: "take-cover"; id: number }
  | { kind: "keep-cover"; id: number };

export type RequestFake = {
  handlers: HttpHandler[];
  writes: RequestWrite[];
};

const SWAPPED = "Swapped for another version";

/** The routes over `initial` requests. A start adds a looking request for `viewer`, or returns theirs already going for the book as the server does; a retry puts one back to looking, or back to choosing after a stopped download. */
export function requestFake(
  initial: BookRequest[] = [],
  {
    books = [HYPERION],
    names = { 1: "Ada Lovelace" },
    viewer = 1,
  }: ListingContext = {},
): RequestFake {
  const requests = new Map(initial.map((r) => [r.id, r]));
  const listing = (r: BookRequest): RequestListing => ({
    request: {
      ...r,
      versions: r.versions.filter(
        (v) => v.rejected || v.id === r.chosen_result_id,
      ),
    },
    book:
      books.find((b) => b.unique_identifier === r.book_uuid) ??
      aWireBook({ unique_identifier: r.book_uuid }),
    requester_name: names[r.user_id] ?? `Reader ${r.user_id}`,
    requester_has_avatar: false,
    cancelled_by_name:
      r.cancelled_by === null || r.cancelled_by === undefined
        ? null
        : (names[r.cancelled_by] ?? null),
  });
  const newestFirst = () => [...requests.values()].sort((a, b) => b.id - a.id);
  // The state a cancel left, which an undo puts back.
  const before = new Map<number, BookRequest["state"]>();
  const fake: RequestFake = { handlers: [], writes: [] };
  const find = (raw: unknown) => requests.get(Number(raw));
  const refuse = (status: number) => new HttpResponse("refused", { status });
  /** Drops the picked version and goes back to choosing among the rest. */
  const giveUpPick = (found: BookRequest) => {
    const back = {
      ...found,
      state: "choose" as const,
      stuck_reason: null,
      stuck_detail: null,
      chosen_result_id: null,
      progress: null,
      note: SWAPPED,
      versions: [
        ...found.versions.filter((v) => v.id !== found.chosen_result_id),
        ...found.versions
          .filter((v) => v.id === found.chosen_result_id)
          .map((v) => ({ ...v, rejected: true })),
      ],
    };
    requests.set(back.id, back);
    return back;
  };
  fake.handlers = [
    http.post("/api/books/:uuid/requests", async ({ params, request }) => {
      StartRequest.parse(await request.json());
      const uuid = String(params.uuid);
      fake.writes.push({ kind: "start", uuid });
      const going = [...requests.values()].find(
        (r) =>
          r.user_id === viewer &&
          r.book_uuid === uuid &&
          r.kind === "ebook" &&
          isLive(r.state),
      );
      if (going) return HttpResponse.json(going);
      const made = aWireRequest({
        id: Math.max(0, ...requests.keys()) + 1,
        book_uuid: uuid,
        user_id: viewer,
      });
      requests.set(made.id, made);
      return HttpResponse.json(made, { status: 201 });
    }),
    http.get("/api/requests", () =>
      HttpResponse.json(newestFirst().map(listing)),
    ),
    http.get("/api/books/:uuid/requests", ({ params }) =>
      HttpResponse.json(
        newestFirst()
          .filter((r) => r.book_uuid === params.uuid)
          .map(listing),
      ),
    ),
    http.get("/api/requests/:id", ({ params }) => {
      const found = find(params.id);
      return found ? HttpResponse.json(found) : refuse(404);
    }),
    http.post("/api/requests/:id/retry", ({ params }) => {
      const found = find(params.id);
      if (!found) return refuse(404);
      if (found.state === "choose" || found.state === "chosen") {
        return refuse(409);
      }
      fake.writes.push({ kind: "retry", id: found.id });
      if (found.stuck_reason === "stopped_moving") {
        return HttpResponse.json(giveUpPick(found));
      }
      const again = {
        ...found,
        state: "looking" as const,
        stuck_reason: null,
        stuck_detail: null,
        versions: [],
      };
      requests.set(again.id, again);
      return HttpResponse.json(again);
    }),
    http.post("/api/requests/:id/choose", async ({ params, request }) => {
      const found = find(params.id);
      if (!found) return refuse(404);
      const { result_id } = ChooseVersion.parse(await request.json());
      if (found.state !== "choose") return refuse(409);
      if (!found.versions.some((v) => v.id === result_id)) return refuse(404);
      fake.writes.push({ kind: "choose", id: found.id, resultId: result_id });
      const chosen = {
        ...found,
        state: "chosen" as const,
        chosen_result_id: result_id,
      };
      requests.set(chosen.id, chosen);
      return HttpResponse.json(chosen);
    }),
  ];
  fake.handlers.push(
    http.post("/api/requests/:id/cancel", ({ params }) => {
      const found = find(params.id);
      if (!found) return refuse(404);
      if (found.state === "stuck" || found.state === "cancelled") {
        return refuse(409);
      }
      fake.writes.push({ kind: "cancel", id: found.id });
      before.set(found.id, found.state);
      const cancelled = {
        ...found,
        state: "cancelled" as const,
        cancelled_by: found.user_id,
        updated_at: Math.floor(Date.now() / 1000),
        // The clock, not NOW: the Undo toast is timed against it, and NOW ages as the file runs.
        cancel_at: Math.floor(Date.now() / 1000) + 8,
      };
      requests.set(cancelled.id, cancelled);
      return HttpResponse.json(cancelled);
    }),
    http.delete("/api/requests/:id/cancel", ({ params }) => {
      const found = find(params.id);
      const restored = found && before.get(found.id);
      if (!found || !restored || found.state !== "cancelled") {
        return refuse(409);
      }
      fake.writes.push({ kind: "undo", id: found.id });
      const back = {
        ...found,
        state: restored,
        cancelled_by: null,
        cancel_at: null,
      };
      requests.set(back.id, back);
      return HttpResponse.json(back);
    }),
    http.post("/api/requests/:id/swap", ({ params }) => {
      const found = find(params.id);
      if (!found) return refuse(404);
      if (found.state !== "on_its_way") return refuse(409);
      fake.writes.push({ kind: "swap", id: found.id });
      return HttpResponse.json(giveUpPick(found));
    }),
  );
  /** A cover write answers the request with its offer gone, or refuses when none is on. */
  const settleCover =
    (kind: "take-cover" | "keep-cover") =>
    ({ params }: { params: Record<string, unknown> }) => {
      const found = find(params.id);
      if (!found) return refuse(404);
      if (!found.cover_offer) return refuse(409);
      fake.writes.push({ kind, id: found.id });
      const settled = { ...found, cover_offer: null };
      requests.set(settled.id, settled);
      return HttpResponse.json(settled);
    };
  fake.handlers.push(
    http.get("/api/requests/:id/cover", svg),
    http.post("/api/requests/:id/cover", settleCover("take-cover")),
    http.delete("/api/requests/:id/cover", settleCover("keep-cover")),
  );
  return fake;
}
