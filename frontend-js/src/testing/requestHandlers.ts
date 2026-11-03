import { type HttpHandler, HttpResponse, http } from "msw";
import {
  type BookRequest,
  ChooseVersion,
  type RequestVersion,
  StartRequest,
} from "../api/generated/schemas";

// A stateful MSW fake of the five book-request routes, in the shape the server sends them.
// A write a story makes shows in the next read; `writes` records them in order.

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
    created_at: "2026-11-03T12:00:00Z",
    updated_at: "2026-11-03T12:00:00Z",
    versions: [],
    ...overrides,
  };
}

/** The writes the fake answered, in order. */
export type RequestWrite =
  | { kind: "start"; uuid: string }
  | { kind: "retry"; id: number }
  | { kind: "choose"; id: number; resultId: number };

export type RequestFake = {
  handlers: HttpHandler[];
  writes: RequestWrite[];
  /** What a request becomes after it is retried (it is searched again at once). */
  afterRetry: Partial<BookRequest>;
  /** The server's refusal for the next start, if any. */
  refuseStart: number | null;
  /** The request a start makes. */
  started: Partial<BookRequest>;
};

/** The routes over `initial` requests. A start adds a looking request; a retry sets `afterRetry`. */
export function requestFake(initial: BookRequest[] = []): RequestFake {
  const requests = new Map(initial.map((r) => [r.id, r]));
  const fake: RequestFake = {
    handlers: [],
    writes: [],
    afterRetry: {},
    refuseStart: null,
    started: {},
  };
  const find = (raw: unknown) => requests.get(Number(raw));
  const refuse = (status: number) => new HttpResponse("refused", { status });
  fake.handlers = [
    http.post("/api/books/:uuid/requests", async ({ params, request }) => {
      StartRequest.parse(await request.json());
      if (fake.refuseStart) return refuse(fake.refuseStart);
      const uuid = String(params.uuid);
      fake.writes.push({ kind: "start", uuid });
      const made = aWireRequest({
        id: Math.max(0, ...requests.keys()) + 1,
        book_uuid: uuid,
        ...fake.started,
      });
      requests.set(made.id, made);
      return HttpResponse.json(made, { status: 201 });
    }),
    http.get("/api/books/:uuid/requests", ({ params }) =>
      HttpResponse.json(
        [...requests.values()].filter((r) => r.book_uuid === params.uuid),
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
      const again = {
        ...found,
        state: "looking" as const,
        stuck_reason: null,
        stuck_detail: null,
        versions: [],
        ...fake.afterRetry,
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
  return fake;
}
