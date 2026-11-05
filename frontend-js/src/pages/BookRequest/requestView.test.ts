import { describe, expect, it } from "vitest";
import { ApiError } from "../../api";
import {
  holdsAudiobook,
  holdsEbook,
  isSearchStale,
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
    ["stuck", "Couldn’t find it"],
  ] as const)("heads a %s request with %s", (state, heading) => {
    expect(stateView(state).heading).toBe(heading);
  });

  it("never uses the downloader's words", () => {
    for (const state of ["looking", "choose", "chosen", "stuck"] as const) {
      const { heading, note } = stateView(state);
      expect(`${heading} ${note}`).not.toMatch(/release|indexer|grab|seed/i);
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
