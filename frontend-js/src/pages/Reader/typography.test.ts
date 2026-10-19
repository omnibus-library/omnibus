import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clampFontSize,
  DEFAULT_PREFS,
  initOptions,
  loadReaderPrefs,
  type ReaderPrefs,
  saveReaderPref,
} from "./typography";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

const NAMES = [
  "fontSize",
  "typeface",
  "lineSpacing",
  "margins",
  "justify",
  "spread",
] as const;

const CHANGED: ReaderPrefs = {
  fontSize: 24,
  typeface: "mono",
  lineSpacing: "airy",
  margins: "wide",
  justify: true,
  spread: "single",
};

describe("loadReaderPrefs", () => {
  it("returns the defaults when nothing is saved", () => {
    expect(loadReaderPrefs()).toEqual(DEFAULT_PREFS);
  });

  it("returns each choice as it was saved", () => {
    for (const name of NAMES) saveReaderPref(name, CHANGED);

    expect(loadReaderPrefs()).toEqual(CHANGED);
  });

  it("saves under the keys the Dioxus reader reads", () => {
    saveReaderPref("lineSpacing", CHANGED);
    saveReaderPref("justify", CHANGED);

    expect(localStorage.getItem("omn.lineSpacing")).toBe("airy");
    expect(localStorage.getItem("omn.justify")).toBe("true");
  });

  it.each([
    ["omn.typeface", "serif-ish"],
    ["omn.typeface", "constructor"],
    ["omn.lineSpacing", ""],
    ["omn.margins", "NARROW"],
    ["omn.spread", "triple"],
    ["omn.fontSize", "big"],
    ["omn.fontSize", "18.5"],
    ["omn.fontSize", ""],
  ])("falls back to the default for %s saved as %j", (key, value) => {
    localStorage.setItem(key, value);

    expect(loadReaderPrefs()).toEqual(DEFAULT_PREFS);
  });

  it("reads any saved justify value other than true as off", () => {
    localStorage.setItem("omn.justify", "yes");

    expect(loadReaderPrefs().justify).toBe(false);
  });

  it("falls back to the defaults when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });

    expect(loadReaderPrefs()).toEqual(DEFAULT_PREFS);
    expect(() => saveReaderPref("fontSize", CHANGED)).not.toThrow();
  });
});

describe("clampFontSize", () => {
  it.each([
    [11, 12],
    [12, 12],
    [32, 32],
    [33, 32],
  ])("holds %i at %i", (size, expected) => {
    expect(clampFontSize(size)).toBe(expected);
  });

  it("clamps a saved size outside the range", () => {
    localStorage.setItem("omn.fontSize", "99");

    expect(loadReaderPrefs().fontSize).toBe(32);
  });
});

describe("initOptions", () => {
  it("opens the original face with no override", () => {
    expect(initOptions(DEFAULT_PREFS)).toMatchObject({
      fontFamily: null,
      lineHeight: "1.7",
      maxWidth: "min(80%, calc(100% - 172px))",
      spread: "auto",
    });
  });
});
