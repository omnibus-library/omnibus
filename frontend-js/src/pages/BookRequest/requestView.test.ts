import { describe, expect, it } from "vitest";
import { ApiError, type RequestVersion } from "../../api";
import {
  firstShown,
  holdsAudiobook,
  holdsEbook,
  isCancellable,
  isDownloading,
  isSearchStale,
  pickedMeta,
  progressPercent,
  requestPath,
  startFailure,
  stateView,
  undoToastMs,
  versionFormat,
  versionSize,
  versionSource,
} from "./requestView";

const NBSP = "\u00a0";

/** A version as the page draws it, with every field set unless told otherwise. */
const aVersion = (overrides: Partial<RequestVersion> = {}): RequestVersion => ({
  id: 1,
  title: "Piranesi - Susanna Clarke (2020) [Retail EPUB]",
  sizeBytes: 1_800_000,
  format: "EPUB",
  indexer: "MyAnonamouse",
  seeders: 142,
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
  it("names a format and says when one is unknown", () => {
    expect(versionFormat("EPUB")).toBe("EPUB");
    expect(versionFormat(null)).toBe("Format unknown");
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
      `MyAnonamouse · EPUB · 1.8${NBSP}MB · 142${NBSP}seeds`,
    );
  });

  it("drops a missing source and missing seeds", () => {
    expect(versionSource(aVersion({ indexer: null, seeders: null }))).toBe(
      `EPUB · 1.8${NBSP}MB`,
    );
  });

  it("says when the format and size are unknown", () => {
    expect(
      versionSource(aVersion({ format: null, sizeBytes: null, seeders: null })),
    ).toBe("MyAnonamouse · Format unknown · Size unknown");
  });

  it.each([
    [1, `1${NBSP}seed`],
    [0, `0${NBSP}seeds`],
    [1234, `1,234${NBSP}seeds`],
  ])("writes %i seeders as %s", (seeders, seeds) => {
    expect(versionSource(aVersion({ indexer: null, seeders }))).toBe(
      `EPUB · 1.8${NBSP}MB · ${seeds}`,
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
    expect(pickedMeta(aVersion())).toBe(`1.8${NBSP}MB · MyAnonamouse`);
  });

  it("leaves out what the source did not say", () => {
    expect(pickedMeta(aVersion({ sizeBytes: null, indexer: null }))).toBe("");
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
