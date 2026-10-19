import { describe, expect, it } from "vitest";
import {
  type AuthorSummary,
  toAuthorReading,
  toAuthorSummary,
} from "../../api";
import { aWireAuthorReading, aWireAuthorSummary } from "../../testing/wire";
import {
  byAuthor,
  computeAuthorGroups,
  creatorSortKey,
  defaultAuthor,
  dictionaryCmp,
  firstLetter,
  foldForMatch,
  letterFrag,
  listPhase,
  nameParts,
  sortAuthors,
} from "./authorsOrder";

function anAuthor(
  name: string,
  sort: string | null = null,
  id = 1,
  bookCount = 1,
): AuthorSummary {
  return toAuthorSummary(
    aWireAuthorSummary({ id, name, sort, book_count: bookCount }),
  );
}

const names = (authors: AuthorSummary[]) => authors.map((a) => a.name);

const noFilter = { text: "", reading: null, onlyReading: false };

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

describe("creatorSortKey", () => {
  it.each([
    [
      "uses a comma-form file-as verbatim",
      "Alcott, Louisa May",
      "Louisa May Alcott",
      "Alcott, Louisa May",
    ],
    [
      "ignores a comma-less file-as and derives from the name",
      "Underwood",
      "Erin A. Craig",
      "Craig, Erin A.",
    ],
    [
      "derives from the name when file-as is missing",
      null,
      "Ada Lovelace",
      "Lovelace, Ada",
    ],
    [
      "derives from the name when file-as is blank",
      "",
      "Ada Lovelace",
      "Lovelace, Ada",
    ],
    [
      "keeps a surname-first name verbatim",
      null,
      "Atwater, Olivia",
      "Atwater, Olivia",
    ],
    ["keeps a mononym whole", null, "Plato", "Plato"],
  ])("%s", (_condition, fileAs, name, key) => {
    expect(creatorSortKey(fileAs, name)).toBe(key);
  });
});

describe("firstLetter", () => {
  it("files an accented initial under its letter", () => {
    expect(firstLetter(anAuthor("Paul Éluard"))).toBe("E");
  });

  it.each(["1984", "[Anonymous]", "中文"])("files %s under #", (name) => {
    expect(firstLetter(anAuthor(name))).toBe("#");
  });
});

describe("letterFrag", () => {
  it("spells # as hash and leaves a letter alone", () => {
    expect(letterFrag("#")).toBe("hash");
    expect(letterFrag("Q")).toBe("Q");
  });
});

describe("nameParts", () => {
  it("splits the surname key and keeps a mononym whole", () => {
    expect(
      nameParts(anAuthor("Ursula K. Le Guin", "Le Guin, Ursula K.")),
    ).toEqual(["Le Guin", "Ursula K."]);
    expect(nameParts(anAuthor("Plato"))).toEqual(["Plato", ""]);
  });
});

describe("sortAuthors", () => {
  it("orders by surname in dictionary order", () => {
    const all = [
      anAuthor("Sarah Polk", "Polk, Sarah"),
      anAuthor("Benito Pérez Galdós", "Pérez Galdós, Benito"),
      anAuthor("Anne Perry"),
      anAuthor("Bret Pettichord", "Bret Pettichord"),
      anAuthor("Ana Pérez", "Pérez, Ana"),
      anAuthor("Ana Perez", "Perez, Ana"),
    ];

    expect(names(sortAuthors(all, "name", null))).toEqual([
      "Ana Perez",
      "Ana Pérez",
      "Benito Pérez Galdós",
      "Anne Perry",
      "Bret Pettichord",
      "Sarah Polk",
    ]);
  });

  it("puts the non-alphabetic bucket after the alphabet", () => {
    const all = [anAuthor("1984"), anAuthor("Ada Lovelace")];

    expect(names(sortAuthors(all, "name", null))).toEqual([
      "Ada Lovelace",
      "1984",
    ]);
  });

  it("orders by book count descending, then surname", () => {
    const all = [
      anAuthor("Alpha", null, 1, 3),
      anAuthor("Bravo", null, 2, 7),
      anAuthor("Able", null, 3, 3),
    ];

    expect(names(sortAuthors(all, "book_count", null))).toEqual([
      "Bravo",
      "Able",
      "Alpha",
    ]);
  });

  it("puts the latest read first and the never-read after, by surname", () => {
    const all = [
      anAuthor("Ada Lovelace", null, 1),
      anAuthor("Bob Lowe", null, 2),
      anAuthor("Cy Twombly", null, 3),
    ];
    const reading = byAuthor(
      [
        aWireAuthorReading({ author_id: 1, last_read_at: 10 }),
        aWireAuthorReading({ author_id: 3, last_read_at: 20 }),
      ].map(toAuthorReading),
    );

    expect(names(sortAuthors(all, "recent", reading))).toEqual([
      "Cy Twombly",
      "Ada Lovelace",
      "Bob Lowe",
    ]);
  });
});

describe("computeAuthorGroups", () => {
  it("matches a name typed without its accents", () => {
    const all = [
      anAuthor("Benito Pérez Galdós"),
      anAuthor("Ada Lovelace", null, 2),
    ];

    const { filtered } = computeAuthorGroups(all, {
      ...noFilter,
      text: "perez galdos",
      sort: "name",
    });

    expect(names(filtered)).toEqual(["Benito Pérez Galdós"]);
  });

  it("buckets by surname letter under the surname sort", () => {
    const all = [
      anAuthor("Benito Pérez Galdós"),
      anAuthor("Ada Lovelace", null, 2),
    ];

    const { letters } = computeAuthorGroups(all, { ...noFilter, sort: "name" });

    expect(letters.map(([letter, group]) => [letter, names(group)])).toEqual([
      ["G", ["Benito Pérez Galdós"]],
      ["L", ["Ada Lovelace"]],
    ]);
  });

  it("draws no letter groups under the other sorts", () => {
    const all = [anAuthor("Ada Lovelace")];

    expect(
      computeAuthorGroups(all, { ...noFilter, sort: "book_count" }).letters,
    ).toEqual([]);
  });

  it("keeps only authors in progress when asked", () => {
    const all = [
      anAuthor("Ada Lovelace", null, 1),
      anAuthor("Bob Lowe", null, 2),
    ];
    const reading = byAuthor([
      toAuthorReading(aWireAuthorReading({ author_id: 1, reading: 0 })),
      toAuthorReading(aWireAuthorReading({ author_id: 2, reading: 1 })),
    ]);

    const { filtered } = computeAuthorGroups(all, {
      text: "",
      sort: "name",
      reading,
      onlyReading: true,
    });

    expect(names(filtered)).toEqual(["Bob Lowe"]);
  });

  it("ignores the reading filter until progress loads", () => {
    const all = [anAuthor("Ada Lovelace")];

    const { filtered } = computeAuthorGroups(all, {
      ...noFilter,
      sort: "name",
      onlyReading: true,
    });

    expect(names(filtered)).toEqual(["Ada Lovelace"]);
  });
});

describe("defaultAuthor", () => {
  it("is the author read most recently", () => {
    const all = [
      anAuthor("Ada Lovelace", null, 1),
      anAuthor("Bob Lowe", null, 2),
    ];
    const reading = byAuthor([
      toAuthorReading(aWireAuthorReading({ author_id: 1, last_read_at: 10 })),
      toAuthorReading(aWireAuthorReading({ author_id: 2, last_read_at: 50 })),
    ]);

    expect(defaultAuthor(all, reading)).toBe(2);
  });

  it("falls back to the first by surname", () => {
    const all = [
      anAuthor("Bob Lowe", null, 1),
      anAuthor("Ada Abbott", null, 2),
    ];

    expect(defaultAuthor(all, null)).toBe(2);
  });

  it("is null for an empty library", () => {
    expect(defaultAuthor([], null)).toBeNull();
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
