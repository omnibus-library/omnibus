import { describe, expect, it } from "vitest";
import {
  ApiError,
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
  versionFormat,
  versionSeeders,
  versionSize,
  wishersLine,
} from "./requestView";

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
  it("is the book's own address with /request and the request's id", () => {
    expect(requestPath("abc-123", 7)).toBe("/books/abc-123/request?id=7");
  });
});

describe("versionFormat", () => {
  it("names a format and calls an unnamed one Unknown", () => {
    expect(versionFormat("EPUB")).toBe("EPUB");
    expect(versionFormat(null)).toBe("Unknown");
  });
});

describe("versionSize", () => {
  it("writes a size in decimal units and leaves a missing one out", () => {
    expect(versionSize(2_400_000)).toBe("2.4 MB");
    expect(versionSize(null)).toBeNull();
  });
});

describe("versionSeeders", () => {
  it.each([
    [12, "12 seeders"],
    [1, "1 seeder"],
    [0, "0 seeders"],
  ])("counts %i as %s", (seeders, label) => {
    expect(versionSeeders(seeders)).toBe(label);
  });

  it("leaves out a source with no seeders", () => {
    expect(versionSeeders(null)).toBeNull();
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
      "Cancelled by you · EPUB · 2.4 MB · stopped at 40%",
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
      "Stopped moving · PDF · 9.1 MB · stopped at 25%",
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
      "Couldn’t add it · EPUB · 2.4 MB",
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
      { id: PDF.id, text: "Swapped for another version · PDF · 9.1 MB" },
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

  it("keeps cancelled and stuck requests in the history", () => {
    const split = splitBookRequests(
      [
        listing({ id: 5, state: "cancelled" }),
        listing({ id: 4, state: "stuck", stuck_reason: "not_found" }),
      ],
      SHOWN,
    );

    expect(ids(split.history)).toEqual([5, 4]);
    expect(split.lanes).toEqual([]);
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

  it.each([
    [59, "less than a minute left"],
    [60, "about 1 min left"],
    [150, "about 3 min left"],
    [3599, "about 1 hour left"],
    [7200, "about 2 hours left"],
  ])("reads %s seconds to go as %s", (secs, expected) => {
    expect(timeLeft(NOW + secs, NOW)).toBe(expected);
  });

  it("says nothing when the client can't tell", () => {
    expect(timeLeft(null, NOW)).toBeNull();
  });
});

/** A version as the page holds it. */
function parsedVersion(overrides: Parameters<typeof aWireVersion>[0]) {
  const [version] = toBookRequest(
    aWireRequest({ versions: [aWireVersion(overrides)] }),
  ).versions;
  if (!version) throw new Error("no version parsed");
  return version;
}

describe("pickedMeta", () => {
  it("joins the version's size and source", () => {
    expect(pickedMeta(parsedVersion({ indexer: "MyAnonamouse" }))).toBe(
      "2.4 MB · MyAnonamouse",
    );
  });

  it("leaves out what the source did not say", () => {
    expect(pickedMeta(parsedVersion({ size_bytes: null, indexer: null }))).toBe(
      "",
    );
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
