import { describe, expect, it } from "vitest";
import { ApiError } from "../../api";
import {
  holdsAudiobook,
  holdsEbook,
  isCancellable,
  isSearchStale,
  progressPercent,
  requestPath,
  startFailure,
  stateView,
  versionFormat,
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

  it("never uses the downloader's words", () => {
    const states = [
      ["looking", null],
      ["choose", null],
      ["chosen", null],
      ["on_its_way", null],
      ["stuck", "not_found"],
      ["stuck", "stopped_moving"],
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
