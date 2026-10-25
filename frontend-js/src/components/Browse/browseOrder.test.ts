import { describe, expect, it } from "vitest";
import {
  dictionaryCmp,
  foldForMatch,
  groupByLetter,
  isNonAlphaKey,
  letterForKey,
  letterFrag,
  listPhase,
} from "./browseOrder";

describe("foldForMatch", () => {
  it("drops accents and case", () => {
    expect(foldForMatch("Benito Pérez Galdós")).toBe("benito perez galdos");
  });
});

describe("dictionaryCmp", () => {
  const inOrder = [
    "Perez, Ana",
    "Pérez Galdós, Benito",
    "Perry, Anne",
    "Pettichord, Bret",
    "Polk, Sarah",
  ];

  it("files accented names in dictionary order", () => {
    expect([...inOrder].reverse().sort((a, b) => dictionaryCmp(a, b))).toEqual(
      inOrder,
    );
  });

  it("puts the plain spelling first on a tie", () => {
    expect(dictionaryCmp("Perez", "Pérez")).toBeLessThan(0);
    expect(dictionaryCmp("Pérez", "Perez")).toBeGreaterThan(0);
    expect(dictionaryCmp("Pérez", "Pérez")).toBe(0);
  });

  it("ignores case before breaking the tie on it", () => {
    expect(dictionaryCmp("apple", "Banana")).toBeLessThan(0);
    expect(dictionaryCmp("Apple", "apple")).toBeLessThan(0);
  });
});

describe("letterForKey", () => {
  it("files an accented initial under its letter", () => {
    expect(letterForKey("Éluard, Paul")).toBe("E");
  });

  it.each(["1984", "[Anonymous]", "中文", ""])("files %j under #", (key) => {
    expect(letterForKey(key)).toBe("#");
    expect(isNonAlphaKey(key)).toBe(true);
  });
});

describe("letterFrag", () => {
  it("spells # as hash and leaves a letter alone", () => {
    expect(letterFrag("#")).toBe("hash");
    expect(letterFrag("Q")).toBe("Q");
  });
});

describe("groupByLetter", () => {
  it("buckets consecutive same-letter rows in order", () => {
    const rows = ["Adams", "Abbott", "Brown", "Clark", "Cole"];

    expect(groupByLetter(rows, (name) => name.charAt(0))).toEqual([
      ["A", ["Adams", "Abbott"]],
      ["B", ["Brown"]],
      ["C", ["Clark", "Cole"]],
    ]);
  });

  it("is empty for no rows", () => {
    expect(groupByLetter([], () => "A")).toEqual([]);
  });
});

describe("listPhase", () => {
  it.each([
    [
      "still loading",
      { isPending: true, isError: false, hasRows: false },
      "loading",
    ],
    [
      "failed with nothing to show",
      { isPending: false, isError: true, hasRows: false },
      "failed",
    ],
    [
      "a failed refresh that kept its rows",
      { isPending: false, isError: true, hasRows: true },
      "ready",
    ],
    [
      "answered with no authors",
      { isPending: false, isError: false, hasRows: false },
      "empty",
    ],
    [
      "answered with authors",
      { isPending: false, isError: false, hasRows: true },
      "ready",
    ],
  ] as const)("is %s", (_case, list, phase) => {
    expect(listPhase(list)).toBe(phase);
  });
});
