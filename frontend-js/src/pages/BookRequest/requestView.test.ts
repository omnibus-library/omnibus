import { describe, expect, it } from "vitest";
import {
  ApiError,
  type RequestVersion,
  toBookRequest,
  toRequestListing,
  type UserId,
} from "../../api";
import {
  aWireListing,
  aWireRequest,
  aWireVersion,
} from "../../testing/requestHandlers";
import {
  canActOn,
  downloadPercent,
  factParts,
  firstShown,
  fromWishlists,
  historyDay,
  holdsAudiobook,
  holdsEbook,
  isCancellable,
  isDownloading,
  isSearchStale,
  offersRequestAgain,
  pickedMeta,
  progressPercent,
  requestFacts,
  requestPath,
  splitBookRequests,
  startFailure,
  stateView,
  stepsFor,
  swapFacts,
  timeLeft,
  undoToastMs,
  versionSize,
  versionSource,
  versionsFound,
  wishersLine,
} from "./requestView";

const NBSP = "\u00a0";
/** A separator that stays on the line of the part before it. */
const SEP = `${NBSP}· `;

/** A version as the page draws it, with every field set unless told otherwise. */
const aVersion = (overrides: Partial<RequestVersion> = {}): RequestVersion => ({
  id: 1,
  title: "Piranesi - Susanna Clarke (2020) [Retail EPUB]",
  sizeBytes: 1_800_000,
  format: "EPUB",
  indexer: "MyAnonamouse",
  seeders: 142,
  protocol: "torrent",
  bestMatch: false,
  rejected: false,
  ...overrides,
});

describe("stateView", () => {
  it.each([
    ["looking", "Looking"],
    ["choose", "Choose a version"],
    ["chosen", "Version chosen"],
    ["on_its_way", "On its way"],
    ["stuck", "Couldn’t find it"],
    ["cancelled", "Cancelled"],
  ] as const)("heads a %s request with %s", (state, heading) => {
    expect(stateView(state).heading).toBe(heading);
  });

  it("heads a request stuck on a stalled download Stopped moving", () => {
    expect(stateView("stuck", "stopped_moving").heading).toBe("Stopped moving");
    expect(stateView("stuck", "search_failed").heading).toBe(
      "Couldn’t find it",
    );
  });

  it("gives choose no note, since the versions found carry it", () => {
    expect(stateView("choose").note).toBeNull();
  });

  it("names ready as Ready to read", () => {
    expect(stateView("ready")).toEqual({
      heading: "Ready to read",
      note: "It’s in the library.",
    });
  });

  it("names couldnt_add as Couldn’t add it", () => {
    expect(stateView("stuck", "couldnt_add")).toEqual({
      heading: "Couldn’t add it",
      note: "It downloaded but couldn’t be added to the library.",
    });
  });

  it("never uses the downloader's words", () => {
    const states = [
      ["looking", null],
      ["choose", null],
      ["chosen", null],
      ["on_its_way", null],
      ["ready", null],
      ["stuck", "not_found"],
      ["stuck", "stopped_moving"],
      ["stuck", "couldnt_add"],
      ["cancelled", null],
    ] as const;
    for (const [state, reason] of states) {
      const { heading, note } = stateView(state, reason);
      expect(`${heading} ${note}`).not.toMatch(
        /release|torrent|indexer|grab|seed/i,
      );
    }
  });
});

describe("startFailure", () => {
  it.each([
    [429, "You have a lot of requests going. Try again in a few minutes."],
    [403, "Your account can’t make requests."],
    [404, "That book is no longer in the library."],
    [500, "Couldn’t start the request."],
  ])("explains a %i in plain words", (status, words) => {
    expect(startFailure(new ApiError(status, "ignored"))).toBe(words);
  });

  it("falls back to the plain failure for an error that is not the server's", () => {
    expect(startFailure(new TypeError("Failed to fetch"))).toBe(
      "Couldn’t start the request.",
    );
  });
});

describe("requestPath", () => {
  it("is the Requests page's address for the book, escaped", () => {
    expect(requestPath("abc 123")).toBe("/requests?book=abc%20123");
  });
});

describe("versionSize", () => {
  it("writes a size in decimal units and leaves a missing one out", () => {
    expect(versionSize(2_400_000)).toBe(`2.4${NBSP}MB`);
    expect(versionSize(null)).toBeNull();
  });
});

describe("versionSource", () => {
  it("names the source, format, size and seeds", () => {
    expect(versionSource(aVersion())).toBe(
      `MyAnonamouse${SEP}EPUB${SEP}1.8${NBSP}MB${SEP}142${NBSP}seeds`,
    );
  });

  it("drops a missing source and missing seeds", () => {
    expect(versionSource(aVersion({ indexer: null, seeders: null }))).toBe(
      `EPUB${SEP}1.8${NBSP}MB`,
    );
  });

  it("ends a Usenet version's line with Usenet in place of seeds", () => {
    const usenet = aVersion({
      indexer: "NZBgeek",
      sizeBytes: 2_100_000,
      seeders: null,
      protocol: "usenet",
    });
    expect(versionSource(usenet)).toBe(
      `NZBgeek${SEP}EPUB${SEP}2.1${NBSP}MB${SEP}Usenet`,
    );
  });

  it("says when the format and size are unknown", () => {
    expect(
      versionSource(aVersion({ format: null, sizeBytes: null, seeders: null })),
    ).toBe(`MyAnonamouse${SEP}Format unknown${SEP}Size unknown`);
  });

  it.each([
    [1, `1${NBSP}seed`],
    [0, `0${NBSP}seeds`],
    [1234, `1,234${NBSP}seeds`],
  ])("writes %i seeders as %s", (seeders, seeds) => {
    expect(versionSource(aVersion({ indexer: null, seeders }))).toBe(
      `EPUB${SEP}1.8${NBSP}MB${SEP}${seeds}`,
    );
  });

  it("uses no downloader word but the seed count", () => {
    const source = versionSource(aVersion({ indexer: "Books" }));
    expect(source).toMatch(/seeds$/);
    expect(source.replace(/[\d,]+\u00a0seeds$/, "")).not.toMatch(
      /release|torrent|indexer|grab|seed/i,
    );
  });
});

describe("pickedMeta", () => {
  it("names the picked version's size and source", () => {
    expect(pickedMeta(aVersion())).toBe(`1.8${NBSP}MB${SEP}MyAnonamouse`);
  });

  it("leaves out what the source did not say", () => {
    expect(pickedMeta(aVersion({ sizeBytes: null, indexer: null }))).toBe("");
  });
});

describe("versionsFound", () => {
  it("counts only the versions that can be chosen", () => {
    const versions = [
      aVersion({ id: 1, bestMatch: true }),
      aVersion({ id: 2 }),
      aVersion({ id: 3, rejected: true }),
    ];
    expect(versionsFound(versions)).toBe("2 versions found · Best match first");
  });

  it("names no best match when no version that can be chosen is one", () => {
    const versions = [
      aVersion({ id: 1 }),
      aVersion({ id: 2, bestMatch: true, rejected: true }),
    ];
    expect(versionsFound(versions)).toBe("1 version found");
  });
});

describe("firstShown", () => {
  const offerable = (id: number) => aVersion({ id });
  const tried = (id: number) => aVersion({ id, rejected: true });

  it("keeps the first four versions that can be chosen and every tried one", () => {
    const versions = [1, 2, 3, 4, 5, 6].map(offerable).concat(tried(7));
    expect(firstShown(versions).map((v) => v.id)).toEqual([1, 2, 3, 4, 7]);
  });

  it("keeps every version when four or fewer can be chosen", () => {
    const versions = [1, 2, 3, 4].map(offerable).concat(tried(5));
    expect(firstShown(versions).map((v) => v.id)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("isSearchStale", () => {
  it("turns true at sixty seconds and not a second before", () => {
    expect(isSearchStale(1000, 1059)).toBe(false);
    expect(isSearchStale(1000, 1060)).toBe(true);
  });
});

describe("holdsEbook", () => {
  it.each([
    [["EPUB"], true],
    [["pdf"], true],
    [["CBZ"], true],
    [["M4B"], false],
    [["PRINT"], false],
    [[], false],
  ])("reads %j as %s", (formats, expected) => {
    expect(holdsEbook(formats)).toBe(expected);
  });
});

describe("holdsAudiobook", () => {
  it("counts M4B, M4A and MP3 and nothing else", () => {
    expect(holdsAudiobook(["mp3"])).toBe(true);
    expect(holdsAudiobook(["EPUB", "PRINT"])).toBe(false);
  });
});

describe("isCancellable", () => {
  it.each([
    ["looking", null, true],
    ["choose", null, true],
    ["chosen", null, true],
    ["on_its_way", null, true],
    ["on_its_way", 0.4, true],
    ["on_its_way", 1, false],
    ["ready", 1, false],
    ["stuck", null, false],
    ["cancelled", null, false],
  ] as const)("reads a %s request at %s as %s", (state, progress, expected) => {
    expect(isCancellable({ state, progress })).toBe(expected);
  });
});

describe("progressPercent", () => {
  it("rounds down so a bar never reads done before it is", () => {
    expect(progressPercent(0.426)).toBe(42);
    expect(progressPercent(0.999)).toBe(99);
  });

  it("never reads 100 while any of the download is left", () => {
    expect(progressPercent(0.99996)).toBe(99);
  });

  it("reads a whole percent through floating-point noise", () => {
    expect(progressPercent(0.29)).toBe(29);
  });

  it("reads a finished download as 100 and an unread one as 0", () => {
    expect(progressPercent(1)).toBe(100);
    expect(progressPercent(null)).toBe(0);
  });
});

describe("isDownloading", () => {
  it.each([
    ["on_its_way", null, true],
    ["on_its_way", 0.99, true],
    ["on_its_way", 1, false],
    ["chosen", null, false],
    ["stuck", 0.4, false],
  ] as const)("reads a %s request at %s as %s", (state, progress, expected) => {
    expect(isDownloading({ state, progress })).toBe(expected);
  });
});

describe("undoToastMs", () => {
  it("ends a second and a half before the server stops taking the cancel back", () => {
    expect(undoToastMs(110, 100)).toBe(8500);
  });

  it("never goes negative once the grace has all but gone", () => {
    expect(undoToastMs(101, 100)).toBe(0);
    expect(undoToastMs(90, 100)).toBe(0);
  });
});

const VIEWER = 1 as UserId;
const EPUB = aWireVersion({ id: 11 });
const PDF = aWireVersion({ id: 12, format: "PDF", size_bytes: 9_100_000 });

/** A listed request, as the lists draw it. */
const listing = (
  request: Parameters<typeof aWireRequest>[0],
  cancelledByName: string | null = null,
) =>
  toRequestListing(
    aWireListing({
      request: aWireRequest(request),
      cancelled_by_name: cancelledByName,
    }),
  );

describe("requestFacts", () => {
  it("records who cancelled it, the version and how far it got", () => {
    const cancelled = listing(
      {
        state: "cancelled",
        cancelled_by: VIEWER,
        chosen_result_id: EPUB.id,
        progress: 0.4,
        versions: [EPUB],
      },
      "Ada Lovelace",
    );

    expect(requestFacts(cancelled, VIEWER)).toBe(
      "Cancelled by you · EPUB · 2.4\u00a0MB · stopped at 40%",
    );
  });

  it("names the reader who cancelled it when that was someone else", () => {
    const cancelled = listing({ state: "cancelled", cancelled_by: 2 }, "Grace");

    expect(requestFacts(cancelled, VIEWER)).toBe("Cancelled by Grace");
  });

  it("says only cancelled once the canceller's account is gone", () => {
    const cancelled = listing({ state: "cancelled", cancelled_by: 9 });

    expect(requestFacts(cancelled, VIEWER)).toBe("Cancelled");
  });

  it("gives a stuck request its reason and how far its download got", () => {
    const stuck = listing({
      state: "stuck",
      stuck_reason: "stopped_moving",
      chosen_result_id: PDF.id,
      progress: 0.25,
      versions: [PDF],
    });

    expect(requestFacts(stuck, VIEWER)).toBe(
      "Stopped moving · PDF · 9.1\u00a0MB · stopped at 25%",
    );
  });

  it("leaves out where a download stopped once it had finished", () => {
    const unfiled = listing({
      state: "stuck",
      stuck_reason: "couldnt_add",
      chosen_result_id: EPUB.id,
      progress: 1,
      versions: [EPUB],
    });

    expect(requestFacts(unfiled, VIEWER)).toBe(
      "Couldn’t add it · EPUB · 2.4\u00a0MB",
    );
  });

  it("names a request with no version picked by its state alone", () => {
    expect(requestFacts(listing({ state: "looking" }), VIEWER)).toBe("Looking");
  });
});

describe("swapFacts", () => {
  it("records each version given up as swapped for another", () => {
    const swapped = listing({
      state: "on_its_way",
      chosen_result_id: EPUB.id,
      versions: [EPUB, { ...PDF, rejected: true }],
    });

    expect(swapFacts(swapped)).toEqual([
      { id: PDF.id, text: "Swapped for another version · PDF · 9.1\u00a0MB" },
    ]);
  });
});

describe("canActOn", () => {
  it.each([
    [
      "an admin on another reader's request",
      true,
      { id: 2, isAdmin: true, canRequest: true },
    ],
    [
      "the requester who may request",
      true,
      { id: 1, isAdmin: false, canRequest: true },
    ],
    ["another reader", false, { id: 2, isAdmin: false, canRequest: true }],
    [
      "the requester who may no longer request",
      false,
      { id: 1, isAdmin: false, canRequest: false },
    ],
  ] as const)("lets %s act: %s", (_who, expected, viewer) => {
    const request = { userId: 1 as UserId };

    expect(canActOn({ ...viewer, id: viewer.id as UserId }, request)).toBe(
      expected,
    );
  });
});

describe("offersRequestAgain", () => {
  const NOW = 1_000;
  const ADA = { id: VIEWER, canRequest: true };
  const cancelled = {
    kind: "ebook",
    state: "cancelled",
    cancelAt: null,
  } as const;

  it("offers it on a cancelled request once its undo has run out", () => {
    expect(offersRequestAgain(cancelled, ADA, [], NOW)).toBe(true);
  });

  it.each([
    ["still open", false, NOW + 1],
    ["ending now", true, NOW],
  ])("with the undo %s offers it: %s", (_when, expected, cancelAt) => {
    const graced = { ...cancelled, cancelAt };

    expect(offersRequestAgain(graced, ADA, [], NOW)).toBe(expected);
  });

  it("holds it back while the viewer has the book's format requested already", () => {
    const live = {
      userId: VIEWER,
      kind: "ebook",
      state: "on_its_way",
    } as const;

    expect(offersRequestAgain(cancelled, ADA, [live], NOW)).toBe(false);
  });

  it("offers it beside another reader's live request", () => {
    const theirs = {
      userId: 2 as UserId,
      kind: "ebook",
      state: "looking",
    } as const;

    expect(offersRequestAgain(cancelled, ADA, [theirs], NOW)).toBe(true);
  });

  it("offers it beside the viewer's live request for the other format", () => {
    const audio = {
      userId: VIEWER,
      kind: "audiobook",
      state: "looking",
    } as const;

    expect(offersRequestAgain(cancelled, ADA, [audio], NOW)).toBe(true);
  });

  it("holds it back from a reader who can't request", () => {
    const viewer = { ...ADA, canRequest: false };

    expect(offersRequestAgain(cancelled, viewer, [], NOW)).toBe(false);
  });

  it("holds it back on a request that wasn't cancelled", () => {
    const stuck = { ...cancelled, state: "stuck" } as const;

    expect(offersRequestAgain(stuck, ADA, [], NOW)).toBe(false);
  });
});

describe("splitBookRequests", () => {
  const SHOWN = 7;
  const ids = (found: readonly { request: { id: number } }[]) =>
    found.map((l) => l.request.id);

  it("gives another reader's live request a lane of its own", () => {
    const split = splitBookRequests(
      [listing({ id: 8, user_id: 2, state: "choose" }), listing({ id: SHOWN })],
      SHOWN,
    );

    expect(ids(split.lanes)).toEqual([8]);
    expect(split.history).toEqual([]);
  });

  it("keeps a cancelled request in the history", () => {
    const split = splitBookRequests(
      [listing({ id: 5, state: "cancelled" })],
      SHOWN,
    );

    expect(ids(split.history)).toEqual([5]);
    expect(split.lanes).toEqual([]);
  });

  it("gives a stuck request a lane of its own and leaves it out of the history", () => {
    const split = splitBookRequests(
      [listing({ id: 4, state: "stuck", stuck_reason: "not_found" })],
      SHOWN,
    );

    expect(ids(split.lanes)).toEqual([4]);
    expect(split.history).toEqual([]);
  });

  it("keeps a request that swapped a version in the history", () => {
    const swapped = listing({
      id: 3,
      state: "ready",
      chosen_result_id: EPUB.id,
      versions: [EPUB, { ...PDF, rejected: true }],
    });

    expect(ids(splitBookRequests([swapped], SHOWN).history)).toEqual([3]);
  });

  it("leaves a ready request with nothing swapped out of the history", () => {
    const ready = listing({ id: 3, state: "ready" });

    expect(splitBookRequests([ready], SHOWN).history).toEqual([]);
  });

  it("never lists the request on screen", () => {
    const shown = listing({ id: SHOWN, state: "cancelled" });

    expect(splitBookRequests([shown], SHOWN)).toEqual({
      lanes: [],
      history: [],
    });
  });
});

describe("fromWishlists", () => {
  it.each([
    ["a wishlist", { from: "wishlists" }, true],
    ["the Requests list", { from: "requests" }, false],
    ["anywhere else", { from: "search" }, false],
    ["no state", null, false],
  ])("reads a page opened from %s", (_where, state, expected) => {
    expect(fromWishlists(state)).toBe(expected);
  });
});

describe("historyDay", () => {
  it("names the day on the reader's calendar without the year", () => {
    const lateOnOct12Utc = Date.UTC(2026, 9, 12, 23) / 1000;

    expect(historyDay(lateOnOct12Utc, "UTC")).toBe("Oct 12");
    expect(historyDay(lateOnOct12Utc, "Pacific/Kiritimati")).toBe("Oct 13");
  });
});

describe("stepsFor", () => {
  const steps = (request: Parameters<typeof aWireRequest>[0]) =>
    stepsFor(toBookRequest(aWireRequest(request)));

  it("makes Looking the current step of a search", () => {
    expect(steps({ state: "looking" })).toEqual([
      { label: "Looking", status: "current", percent: null },
      { label: "Choose a version", status: "todo", percent: null },
      { label: "On its way", status: "todo", percent: null },
      { label: "Ready", status: "todo", percent: null },
    ]);
  });

  it("counts what the search found once the reader is choosing", () => {
    expect(steps({ state: "choose", versions: [EPUB, PDF] })).toEqual([
      { label: "Looking · 2 found", status: "done", percent: null },
      { label: "Choose a version", status: "current", percent: null },
      { label: "On its way", status: "todo", percent: null },
      { label: "Ready", status: "todo", percent: null },
    ]);
  });

  it("names the pick made and carries the download's percent", () => {
    const downloading = steps({
      state: "on_its_way",
      chosen_result_id: EPUB.id,
      progress: 0.62,
      versions: [EPUB],
    });

    expect(downloading?.slice(1, 3)).toEqual([
      { label: "Chose a version", status: "done", percent: null },
      { label: "On its way", status: "current", percent: 62 },
    ]);
  });

  it("leaves the percent off a picked version not yet started", () => {
    expect(steps({ state: "chosen", versions: [EPUB] })?.[2]).toEqual({
      label: "On its way",
      status: "current",
      percent: null,
    });
  });

  it("marks every step done once the book is ready", () => {
    const ready = steps({ state: "ready", versions: [EPUB] });

    expect(ready?.map((step) => step.status)).toEqual([
      "done",
      "done",
      "done",
      "done",
    ]);
  });

  it.each(["stuck", "cancelled"] as const)(
    "has no steps for a %s request",
    (state) => {
      expect(steps({ state })).toBeNull();
    },
  );
});

describe("timeLeft", () => {
  const NOW = 1_000;
  const at = (secs: number, progress = 0.5) => ({
    expectedDoneAt: NOW + secs,
    progress,
  });

  it.each([
    [1, "less than a minute left"],
    [59, "less than a minute left"],
    [60, "about 1 min left"],
    [150, "about 3 min left"],
    [3599, "about 1 hour left"],
    [7200, "about 2 hours left"],
  ])("reads %s seconds to go as %s", (secs, expected) => {
    expect(timeLeft(at(secs), NOW)).toBe(expected);
  });

  it.each([
    ["the client can't tell", { expectedDoneAt: null, progress: 0.5 }],
    ["the time has come", at(0)],
    ["the time has passed", at(-30)],
    ["the download is complete", at(120, 1)],
  ])("says nothing once %s", (_when, request) => {
    expect(timeLeft(request, NOW)).toBeNull();
  });
});

describe("downloadPercent", () => {
  it.each([
    ["a download under way", { state: "on_its_way", progress: 0.62 }, 62],
    ["one not yet reported", { state: "on_its_way", progress: null }, null],
    ["a complete one", { state: "on_its_way", progress: 1 }, null],
    ["a stuck one", { state: "stuck", progress: 0.4 }, null],
  ] as const)("shows %s as %s", (_case, request, expected) => {
    expect(downloadPercent(request)).toBe(expected);
  });
});

describe("factParts", () => {
  it("splits what happened from the version and how far it got", () => {
    const cancelled = listing(
      {
        state: "cancelled",
        cancelled_by: VIEWER,
        chosen_result_id: EPUB.id,
        progress: 0.4,
        versions: [EPUB],
      },
      "Ada Lovelace",
    );

    expect(factParts(cancelled, VIEWER)).toEqual({
      head: "Cancelled by you",
      details: ["EPUB", "2.4\u00a0MB", "stopped at 40%"],
    });
  });
});

describe("wishersLine", () => {
  const wanter = (id: number, name: string) => ({ id: id as UserId, name });

  it.each([
    ["nobody", [], null],
    ["one reader", [wanter(2, "Jordan")], "On Jordan’s wishlist"],
    [
      "two readers",
      [wanter(2, "Jordan"), wanter(3, "Riley")],
      "On Jordan’s and Riley’s wishlists",
    ],
    [
      "three readers, the viewer among them",
      [wanter(2, "Jordan"), wanter(1, "Ada"), wanter(3, "Riley")],
      "On Jordan’s, your and Riley’s wishlists",
    ],
  ])("reads %s", (_who, wanters, expected) => {
    expect(wishersLine(wanters, VIEWER)).toBe(expected);
  });
});
