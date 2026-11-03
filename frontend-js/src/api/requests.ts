import { queryOptions } from "@tanstack/react-query";
import type { BookUuid, UserId } from "./core";
import { ok, send } from "./core";
import {
  getBookRequest,
  getCancelBookRequestUrl,
  getChooseRequestVersionUrl,
  getRequestsSettings,
  getRetryBookRequestUrl,
  getStartBookRequestUrl,
  getSwapRequestVersionUrl,
  getTestDownloadClientConnectionUrl,
  getTestProwlarrConnectionUrl,
  getUndoCancelBookRequestUrl,
  setRequestsSettings,
} from "./generated/omnibus";
import type {
  BookRequest as BookRequestWire,
  RequestsSettingsStatus,
  RequestsSettingsUpdate,
  RequestVersion as RequestVersionWire,
} from "./generated/schemas";
import { BookRequest as BookRequestSchema } from "./generated/schemas";

export type {
  RequestState,
  RequestsSettingsStatus,
  RequestsSettingsUpdate,
  StuckReason,
} from "./generated/schemas";

// The Requests section's reads and writes. Every query key starts with "admin".

/** The Prowlarr and download client connections; both secrets come back masked. */
export const requestsSettingsQuery = queryOptions({
  queryKey: ["admin", "requests"],
  queryFn: async () => ok(await getRequestsSettings()),
});

/** Replaces the connections; answers what the server now holds. */
export async function saveRequestsSettings(
  update: RequestsSettingsUpdate,
): Promise<RequestsSettingsStatus> {
  return ok(await setRequestsSettings(update));
}

/** Asks Prowlarr, through the server, whether the saved address and key work; a refusal throws its plain reason. */
export async function testProwlarr() {
  await send(getTestProwlarrConnectionUrl(), "POST");
}

/** Asks the download client, through the server, whether the saved address and login work; a refusal throws its plain reason. */
export async function testDownloadClient() {
  await send(getTestDownloadClientConnectionUrl(), "POST");
}

// A reader's book requests. Every query key starts with "requests".

function toVersion(wire: RequestVersionWire) {
  return {
    id: wire.id,
    title: wire.title,
    sizeBytes: wire.size_bytes ?? null,
    format: wire.format ?? null,
    indexer: wire.indexer ?? null,
    bestMatch: wire.best_match,
  };
}

export type RequestVersion = ReturnType<typeof toVersion>;

/** A request as the page draws it. */
export function toBookRequest(wire: BookRequestWire) {
  return {
    id: wire.id,
    bookUuid: wire.book_uuid as BookUuid,
    userId: wire.user_id as UserId,
    kind: wire.kind,
    state: wire.state,
    stuckReason: wire.stuck_reason ?? null,
    stuckDetail: wire.stuck_detail ?? null,
    chosenResultId: wire.chosen_result_id ?? null,
    /** 0 to 1 while the download runs. */
    progress: wire.progress ?? null,
    /** Unix seconds; when a cancelled request stops being undoable. */
    cancelAt: wire.cancel_at ?? null,
    cancelledBy: (wire.cancelled_by ?? null) as UserId | null,
    note: wire.note ?? null,
    /** Unix seconds. */
    updatedAt: wire.updated_at,
    versions: wire.versions.map(toVersion),
  };
}

export type BookRequest = ReturnType<typeof toBookRequest>;

/** How often a request still moving is asked about again. */
export const REQUEST_POLL_MS = 2000;

/** One request; while it is looking, picked or downloading, it is read again every couple of seconds. */
export const bookRequestQuery = (id: number) =>
  queryOptions({
    queryKey: ["requests", id],
    queryFn: async () => toBookRequest(ok(await getBookRequest(id))),
    refetchInterval: (query) => {
      const state = query.state.data?.state;
      const moving =
        state === "looking" || state === "chosen" || state === "on_its_way";
      return moving ? REQUEST_POLL_MS : false;
    },
  });

async function answered(res: Response): Promise<BookRequest> {
  return toBookRequest(BookRequestSchema.parse(await res.json()));
}

/** Starts looking for an ebook of the book, or returns the request already going. */
export async function startBookRequest(uuid: BookUuid): Promise<BookRequest> {
  const url = getStartBookRequestUrl(encodeURIComponent(uuid));
  return answered(await send(url, "POST", { kind: "ebook" }));
}

/** Looks again for a request that came up empty. */
export async function retryBookRequest(id: number): Promise<BookRequest> {
  return answered(await send(getRetryBookRequestUrl(id), "POST"));
}

/** Picks one of the versions a request found. */
export async function chooseRequestVersion(
  id: number,
  resultId: number,
): Promise<BookRequest> {
  const url = getChooseRequestVersionUrl(id);
  return answered(await send(url, "POST", { result_id: resultId }));
}

/** Cancels a request at once; its download stops a few seconds later, until when it can be undone. */
export async function cancelBookRequest(id: number): Promise<BookRequest> {
  return answered(await send(getCancelBookRequestUrl(id), "POST"));
}

/** Takes a cancel back while its grace lasts. */
export async function undoCancelBookRequest(id: number): Promise<BookRequest> {
  return answered(await send(getUndoCancelBookRequestUrl(id), "DELETE"));
}

/** Gives up the version that is downloading and goes back to choosing among the others. */
export async function swapRequestVersion(id: number): Promise<BookRequest> {
  return answered(await send(getSwapRequestVersionUrl(id), "POST"));
}
