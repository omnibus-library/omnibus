import { describe, expect, it } from "vitest";
import { fontCss, inkFor, sizeCss } from "./quoteStyle";

describe("inkFor", () => {
  it.each([
    ["white", "#ffffff", "#221d18"],
    ["black", "#000000", "#f5f0e8"],
    ["a light grey", "#c0c0c0", "#221d18"],
    ["a mid grey", "#7f7f7f", "#f5f0e8"],
    ["a deep blue", "#1b2a6b", "#f5f0e8"],
    ["a bright yellow", "#ffe135", "#221d18"],
  ])("picks the ink for %s", (_condition, hex, ink) => {
    expect(inkFor(hex)).toBe(ink);
  });

  it.each([
    ["not a colour", "nope"],
    ["a short hex", "#fff"],
    ["empty", ""],
  ])("falls back to the light ink for %s", (_condition, hex) => {
    expect(inkFor(hex)).toBe("#f5f0e8");
  });
});

describe("fontCss", () => {
  it.each([
    ["serif", "var(--serif)"],
    ["sans", "var(--sans)"],
    ["mono", "var(--mono)"],
    ["cursive", "var(--serif)"],
  ])("maps %s to %s", (key, css) => {
    expect(fontCss(key)).toBe(css);
  });
});

describe("sizeCss", () => {
  it.each([
    ["s", "18px"],
    ["m", "22px"],
    ["l", "27px"],
    ["xl", "22px"],
  ])("maps %s to %s", (key, css) => {
    expect(sizeCss(key)).toBe(css);
  });
});
