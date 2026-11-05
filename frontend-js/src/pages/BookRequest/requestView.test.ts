import { describe, expect, it } from "vitest";
import { ApiError, toRequestListing, type UserId } from "../../api";
import {
  aWireListing,
  aWireRequest,
  aWireVersion,
} from "../../testing/requestHandlers";
import {
  canActOn,
  holdsAudiobook,
  holdsEbook,
  isCancellable,
  isDownloading,
  isSearchStale,
  matchesBook,
  progressPercent,
  requestFacts,
  requestPath,
  startFailure,
  stateView,
  swapFacts,
  undoToastMs,
  versionFormat,
  versionSeeders,
  versionSize,
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

describe("matchesBook", () => {
  const hyperion = listing({});

  it.each([
    ["an empty filter", true, ""],
    ["part of the title in any case", true, "hyper"],
    ["an author", true, "simmons"],
    ["another book", false, "dune"],
  ])("matches %s: %s", (_case, expected, query) => {
    expect(matchesBook(hyperion, query)).toBe(expected);
  });
});
