import { describe, expect, it } from "vitest";
import { quietReadersNote } from "./journal";

describe("quietReadersNote", () => {
  it.each([
    [
      ["Maya"],
      "Maya rated or reviewed this book but hasn't shared journal entries. When they do, they show up here.",
    ],
    [
      ["Maya", "Jordan"],
      "Maya and Jordan rated or reviewed this book but haven't shared journal entries. When they do, they show up here.",
    ],
    [
      ["Maya", "Jordan", "Sam"],
      "Maya, Jordan, and Sam rated or reviewed this book but haven't shared journal entries. When they do, they show up here.",
    ],
  ])("names %j", (names, note) => {
    expect(quietReadersNote(names)).toBe(note);
  });

  it("has no note when nobody is quiet", () => {
    expect(quietReadersNote([])).toBeNull();
  });
});
