import { type HttpHandler, HttpResponse, http } from "msw";
import {
  type BookRequest,
  ChooseVersion,
  type RequestVersion,
  StartRequest,
} from "../api/generated/schemas";

// A stateful MSW fake of the book-request routes, in the shape the server sends them.
// A write a story makes shows in the next read; `writes` records them in order.

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
    cancel_at: null,
    cancelled_by: null,
    note: null,
    created_at: NOW,
    updated_at: NOW,
    versions: [],
    ...overrides,
  };
}

/** The writes the fake answered, in order. */
export type RequestWrite =
  | { kind: "start"; uuid: string }
  | { kind: "retry"; id: number }
  | { kind: "cancel"; id: number }
  | { kind: "undo"; id: number }
  | { kind: "swap"; id: number }
  | { kind: "choose"; id: number; resultId: number };

export type RequestFake = {
  handlers: HttpHandler[];
  writes: RequestWrite[];
};

const SWAPPED = "Swapped for another version";

/** The routes over `initial` requests. A start adds a looking request; a retry puts one back to looking, or back to choosing after a stopped download. */
export function requestFake(initial: BookRequest[] = []): RequestFake {
  const requests = new Map(initial.map((r) => [r.id, r]));
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
      const made = aWireRequest({
        id: Math.max(0, ...requests.keys()) + 1,
        book_uuid: uuid,
      });
      requests.set(made.id, made);
      return HttpResponse.json(made, { status: 201 });
    }),
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
  return fake;
}
