import { describe, expect, it } from "vitest";
import type { ScanTallies, TaskKind } from "../../api";
import {
  activeTalliesLine,
  bakeErrorsMessage,
  ghostWarningMessage,
  talliesChanges,
  workerKindLabel,
} from "./workerLines";

function tallies(overrides: Partial<ScanTallies>): ScanTallies {
  return {
    found: 0,
    new: 0,
    changed: 0,
    removed: 0,
    moved: 0,
    unchanged: 0,
    ...overrides,
  };
}

const uuids = (n: number) => Array.from({ length: n }, (_, i) => `uuid-${i}`);

describe("workerKindLabel", () => {
  const labels: [TaskKind, string, string][] = [
    ["scan", "Scanning library", "Library scan"],
    ["generate_thumbs", "Generating thumbnail", "Thumbnail generation"],
    ["resolve_author_photo", "Resolving author photo", "Author photo lookup"],
    [
      "refetch_author_photos",
      "Refetching author photos",
      "Author photo refetch",
    ],
    [
      "backfill_chapters",
      "Extracting audiobook chapters",
      "Audiobook chapter extraction",
    ],
    ["resolve_suggestions", "Finding suggestions", "Suggestion lookup"],
  ];

  it.each(labels)("names %s while running", (kind, running) => {
    expect(workerKindLabel(kind, true)).toBe(running);
  });

  it.each(labels)("names %s once finished", (kind, _running, finished) => {
    expect(workerKindLabel(kind, false)).toBe(finished);
  });
});

describe("talliesChanges", () => {
  it("drops zero buckets and joins the rest", () => {
    expect(talliesChanges(tallies({ new: 3, removed: 2 }))).toBe(
      "3 new · 2 removed",
    );
  });

  it("lists every bucket in order", () => {
    expect(
      talliesChanges(tallies({ new: 1, changed: 2, removed: 3, moved: 4 })),
    ).toBe("1 new · 2 changed · 3 removed · 4 moved");
  });

  it("reads no changes when every bucket is zero", () => {
    expect(talliesChanges(tallies({ found: 12, unchanged: 12 }))).toBe(
      "no changes",
    );
  });
});

describe("activeTalliesLine", () => {
  it("puts the found count before the changes", () => {
    expect(activeTalliesLine(tallies({ found: 340, new: 3, removed: 2 }))).toBe(
      "Found 340 — 3 new · 2 removed",
    );
  });

  it("reads no changes for a quiet walk", () => {
    expect(activeTalliesLine(tallies({ found: 12 }))).toBe(
      "Found 12 — no changes",
    );
  });
});

describe("ghostWarningMessage", () => {
  it("names the removed count and the total", () => {
    expect(ghostWarningMessage({ removed: 15, total: 100 })).toBe(
      "15 of 100 books lost their files in this scan — check that your library path is mounted.",
    );
  });
});

describe("bakeErrorsMessage", () => {
  it("says book for a single failure", () => {
    expect(bakeErrorsMessage(["uuid-solo"])).toBe(
      "1 book failed to bake: uuid-solo.",
    );
  });

  it("names every uuid up to the cap", () => {
    expect(bakeErrorsMessage(uuids(5))).toBe(
      "5 books failed to bake: uuid-0, uuid-1, uuid-2, uuid-3, uuid-4.",
    );
  });

  it("names the first five and counts the rest past the cap", () => {
    expect(bakeErrorsMessage(uuids(6))).toBe(
      "6 books failed to bake: uuid-0, uuid-1, uuid-2, uuid-3, uuid-4, and 1 more.",
    );
    expect(bakeErrorsMessage(uuids(8))).toContain(", and 3 more.");
  });
});
