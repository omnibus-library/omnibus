import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ListeningResume } from "../api";
import {
  bootResumePosition,
  createPositionSaver,
  loadLocalPosition,
  loadLocalRate,
  loadVolume,
  needsReload,
  resolveBootFile,
  resolveBootPosition,
  resolveFollowBoot,
  resolveRate,
  saveLocalPosition,
  saveLocalRate,
  saveVolume,
} from "./boot";

const candidate = (
  overrides: Partial<ListeningResume> = {},
): ListeningResume => ({
  state: "candidate",
  follow: true,
  candidate: { fileId: 917, seconds: 21_822 },
  ...overrides,
});

describe("resolveBootFile", () => {
  it("prefers the explicit pick, then the saved row's file, else none", () => {
    expect(resolveBootFile(917, 919)).toBe(917);
    expect(resolveBootFile(null, 919)).toBe(919);
    expect(resolveBootFile(null, null)).toBeNull();
  });
});

describe("resolveBootPosition", () => {
  it("takes the row's seconds on a multi-file book when the row names the loaded file", () => {
    expect(
      resolveBootPosition({ fileId: 919, seconds: 23_718 }, 5, 919, 5),
    ).toBe(23_718);
  });

  it("stays unseeded when multi-file seconds can't be attributed to the loaded file", () => {
    expect(
      resolveBootPosition({ fileId: 919, seconds: 23_718 }, 5, 917, 5),
    ).toBeNull();
    expect(
      resolveBootPosition({ fileId: null, seconds: 23_718 }, 5, 917, 5),
    ).toBeNull();
    expect(resolveBootPosition(null, 5, 917, 5)).toBeNull();
  });

  it("takes the saved seconds on a single-file book whatever file the row names", () => {
    expect(resolveBootPosition({ fileId: 1, seconds: 120 }, 5, 2, 1)).toBe(120);
    expect(resolveBootPosition(null, 42.5, 2, 1)).toBe(42.5);
  });

  it("treats a server that sends no file count as single-file", () => {
    expect(
      resolveBootPosition({ fileId: null, seconds: 300 }, 5, null, 0),
    ).toBe(300);
  });

  it("resumes the row an iOS client wrote at the same file of a five-file book", () => {
    const ios = { fileId: 917, seconds: 21_822 };

    expect(resolveBootPosition(ios, null, 917, 5)).toBe(21_822);
  });
});

describe("resolveFollowBoot", () => {
  it("seeds the mapped file and seconds", () => {
    expect(resolveFollowBoot(null, candidate())).toEqual({
      fileId: 917,
      seconds: 21_822,
    });
  });

  it("stands aside for an explicit pick of another file, and keeps for the same one", () => {
    expect(resolveFollowBoot(919, candidate())).toBeNull();
    expect(resolveFollowBoot(917, candidate())).toEqual({
      fileId: 917,
      seconds: 21_822,
    });
  });

  it("needs follow on, the candidate state and a candidate that names a file", () => {
    expect(resolveFollowBoot(null, candidate({ follow: false }))).toBeNull();
    expect(resolveFollowBoot(null, candidate({ state: "aligned" }))).toBeNull();
    expect(resolveFollowBoot(null, null)).toBeNull();
    expect(
      resolveFollowBoot(
        null,
        candidate({ candidate: { fileId: null, seconds: 10 } }),
      ),
    ).toBeNull();
  });
});

describe("bootResumePosition", () => {
  const follow = { fileId: 917, seconds: 1200 };
  const row = { fileId: 919, seconds: 50 };

  it("applies the follow seconds when the loaded file matches or is unknown", () => {
    expect(bootResumePosition(follow, row, null, 917, 5)).toBe(1200);
    expect(bootResumePosition(follow, row, null, null, 5)).toBe(1200);
  });

  it("falls back to the row when a dead row swapped the file", () => {
    expect(bootResumePosition(follow, row, null, 919, 5)).toBe(50);
  });
});

describe("resolveRate", () => {
  it("takes the server's rate without seeding it", () => {
    expect(resolveRate(1.25, 1.5)).toEqual({ rate: 1.25, seed: false });
  });

  it("seeds the server with the local rate when it has none", () => {
    expect(resolveRate(null, 1.5)).toEqual({ rate: 1.5, seed: true });
    expect(resolveRate(null, null)).toEqual({ rate: 1, seed: false });
  });

  it("does not read a failed fetch as none", () => {
    expect(resolveRate("failed", 1.5)).toEqual({ rate: 1.5, seed: false });
    expect(resolveRate("failed", null)).toEqual({ rate: 1, seed: false });
  });
});

describe("needsReload", () => {
  const booted = { uuid: "book-a", fileId: 917 };

  it("reloads for nothing booted, a new book or an explicit other file", () => {
    expect(needsReload(null, "book-a", null)).toBe(true);
    expect(needsReload(booted, "book-b", 940)).toBe(true);
    expect(needsReload(booted, "book-a", 918)).toBe(true);
  });

  it("keeps playing for the same file or a bare relink", () => {
    expect(needsReload(booted, "book-a", 917)).toBe(false);
    expect(needsReload(booted, "book-a", null)).toBe(false);
  });
});

describe("createPositionSaver", () => {
  it("never saves a heartbeat the user didn't act on, and saves them 5 s apart", () => {
    const save = vi.fn();
    const saver = createPositionSaver(save);

    saver.time(100, false);
    expect(save).not.toHaveBeenCalled();
    saver.time(100, true);
    saver.time(103, true);
    saver.time(105, true);

    expect(save.mock.calls).toEqual([[100], [105]]);
  });

  it("saves a seek at once and restarts the window", () => {
    const save = vi.fn();
    const saver = createPositionSaver(save);
    saver.time(100, true);

    saver.seeked(300);
    saver.time(302, true);
    saver.time(306, true);

    expect(save.mock.calls).toEqual([[100], [300], [306]]);
  });

  it("saves a pause only after the user acted", () => {
    const save = vi.fn();
    const saver = createPositionSaver(save);

    saver.pause(50, false);
    expect(save).not.toHaveBeenCalled();
    saver.pause(50, true);

    expect(save).toHaveBeenCalledWith(50);
  });
});

describe("prefs", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("round-trips a position, a rate and a volume under the keys Dioxus uses", () => {
    saveLocalPosition("u", 12.5);
    saveLocalRate(7, "u", 1.5);
    saveVolume(0.4);

    expect(loadLocalPosition("u")).toBe(12.5);
    expect(localStorage.getItem("omn.listening::u")).toBe("12.5");
    expect(loadLocalRate(7, "u")).toBe(1.5);
    expect(localStorage.getItem("omn.listening.rate::7::u")).toBe("1.5");
    expect(loadVolume()).toBe(0.4);
    expect(localStorage.getItem("omnibus.listen.volume")).toBe("0.4");
  });

  it("reads garbage, a non-finite or an out-of-range value as absent", () => {
    localStorage.setItem("omn.listening::u", "soon");
    localStorage.setItem("omn.listening::v", "-3");
    localStorage.setItem("omn.listening.rate::7::u", "9");
    localStorage.setItem("omn.listening.rate::7::v", "NaN");

    expect(loadLocalPosition("u")).toBeNull();
    expect(loadLocalPosition("v")).toBeNull();
    expect(loadLocalRate(7, "u")).toBeNull();
    expect(loadLocalRate(7, "v")).toBeNull();
    expect(loadLocalPosition("never")).toBeNull();
  });

  it("clamps a volume into range and reads a non-finite one as full", () => {
    localStorage.setItem("omnibus.listen.volume", "-1");
    expect(loadVolume()).toBe(0);
    localStorage.setItem("omnibus.listen.volume", "5");
    expect(loadVolume()).toBe(1);
    localStorage.setItem("omnibus.listen.volume", "loud");
    expect(loadVolume()).toBe(1);
  });

  it("reads as absent when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });

    expect(loadLocalPosition("u")).toBeNull();
    expect(loadLocalRate(7, "u")).toBeNull();
    expect(loadVolume()).toBe(1);
    expect(() => saveLocalPosition("u", 1)).not.toThrow();
  });
});
