import { describe, expect, it } from "vitest";
import {
  DEFAULT_PREFS,
  handoffClauses,
  lastLibrary,
  loadDiscoveryPrefs,
  loadPrefs,
  loadShelfSelection,
  type Prefs,
  reconcile,
  saveDiscoverySort,
  savePlan,
  savePrefs,
  saveShelfSelection,
} from "./viewPrefs";

const SAVED: Prefs = {
  view: "table",
  sort: "author",
  dir: "desc",
  clauses: [{ field: "format", mode: "include", values: ["epub"] }],
  filtersOpen: true,
};

describe("loadPrefs", () => {
  it("returns what savePrefs stored for that library", () => {
    savePrefs("/books", SAVED);

    expect(loadPrefs("/books")).toEqual(SAVED);
    expect(loadPrefs("/elsewhere")).toEqual(DEFAULT_PREFS);
  });

  it("stores the JSON the Dioxus client reads", () => {
    savePrefs("/books", SAVED);

    expect(
      JSON.parse(localStorage.getItem("omnibus.view_prefs::/books") ?? ""),
    ).toEqual({
      view_mode: "table",
      sort_key: "author",
      sort_dir: "desc",
      filters: { clauses: SAVED.clauses },
      filters_open: true,
    });
  });

  it("reads a record Dioxus wrote before filters existed", () => {
    localStorage.setItem(
      "omnibus.view_prefs::/books",
      '{"view_mode":"grid","sort_key":"series","sort_dir":"asc"}',
    );

    expect(loadPrefs("/books")).toEqual({ ...DEFAULT_PREFS, sort: "series" });
  });

  it("reads the facet lists an older client stored as include clauses", () => {
    localStorage.setItem(
      "omnibus.view_prefs::/books",
      '{"view_mode":"table","sort_key":"author","sort_dir":"desc","filters":{"authors":["Ada"]}}',
    );

    expect(loadPrefs("/books")).toEqual({
      ...DEFAULT_PREFS,
      view: "table",
      sort: "author",
      dir: "desc",
      clauses: [{ field: "author", mode: "include", values: ["Ada"] }],
    });
  });

  it("leaves out the stored facet values the API would refuse", () => {
    const tooLong = "x".repeat(513);
    localStorage.setItem(
      "omnibus.view_prefs::/books",
      `{"view_mode":"grid","sort_key":"title","sort_dir":"asc","filters":{"tags":["  ","x","${tooLong}"]}}`,
    );

    expect(loadPrefs("/books").clauses).toEqual([
      { field: "tag", mode: "include", values: ["x"] },
    ]);
  });

  it.each([
    ["not json", "{"],
    [
      "an unknown sort key",
      '{"view_mode":"grid","sort_key":"nope","sort_dir":"asc"}',
    ],
  ])("falls back to the defaults on %s", (_name, raw) => {
    localStorage.setItem("omnibus.view_prefs::/books", raw);

    expect(loadPrefs("/books")).toEqual(DEFAULT_PREFS);
  });
});

describe("lastLibrary", () => {
  it("is null until a save, then the path last saved", () => {
    expect(lastLibrary()).toBeNull();

    savePrefs("/a", SAVED);
    savePrefs("/b", SAVED);

    expect(lastLibrary()).toBe("/b");
  });
});

describe("savePlan", () => {
  it("writes under the known library path", () => {
    expect(savePlan("/a", false, "/b")).toEqual({
      writeTo: "/a",
      unsaved: false,
    });
  });

  it("holds an edit for the reconcile while page 1 is still pending", () => {
    expect(savePlan(null, false, "/b")).toEqual({
      writeTo: null,
      unsaved: true,
    });
  });

  it("writes under the pointer once page 1 has failed", () => {
    expect(savePlan(null, true, "/b")).toEqual({
      writeTo: "/b",
      unsaved: true,
    });
  });
});

describe("reconcile", () => {
  it.each([
    [null, "/a", true, "save"],
    ["/a", "/a", true, "save"],
    ["/a", "/a", false, "keep"],
    [null, "/a", false, "adopt"],
    ["/a", "/b", false, "adopt"],
  ] as const)(
    "from %s to %s (unsaved %s) is %s",
    (was, path, unsaved, action) => {
      expect(reconcile(was, path, unsaved)).toBe(action);
    },
  );
});

describe("saveShelfSelection", () => {
  it("round trips a shelf and the whole library through loadShelfSelection", () => {
    saveShelfSelection({ kind: "shelf", id: 42 });
    expect(loadShelfSelection()).toEqual({ kind: "shelf", id: 42 });

    saveShelfSelection({ kind: "all" });
    expect(loadShelfSelection()).toEqual({ kind: "all" });
  });
});

describe("loadShelfSelection", () => {
  it("reads unparsable JSON as the whole library", () => {
    localStorage.setItem("omnibus.landing_shelf", '{"kind":"shelf"}');

    expect(loadShelfSelection()).toEqual({ kind: "all" });
  });
});

describe("loadDiscoveryPrefs", () => {
  it("is by name everywhere until a sort is saved", () => {
    expect(loadDiscoveryPrefs()).toEqual({
      authors_sort: "name",
      series_sort: "name",
      shelves_sort: "name",
    });
  });

  it("reads the JSON the Dioxus client stored", () => {
    localStorage.setItem(
      "omnibus.discovery_prefs",
      '{"authors_sort":"recent","shelves_sort":"book_count"}',
    );

    expect(loadDiscoveryPrefs()).toEqual({
      authors_sort: "recent",
      series_sort: "name",
      shelves_sort: "book_count",
    });
  });

  it("falls back to name for a value the client does not know", () => {
    localStorage.setItem("omnibus.discovery_prefs", '{"series_sort":"recent"}');

    expect(loadDiscoveryPrefs().series_sort).toBe("name");
  });
});

describe("saveDiscoverySort", () => {
  it("rewrites the one field and keeps the others", () => {
    saveDiscoverySort("authors_sort", "book_count");
    saveDiscoverySort("shelves_sort", "book_count");
    saveDiscoverySort("authors_sort", "recent");

    expect(
      JSON.parse(localStorage.getItem("omnibus.discovery_prefs") ?? ""),
    ).toEqual({
      authors_sort: "recent",
      series_sort: "name",
      shelves_sort: "book_count",
    });
  });
});

describe("handoffClauses", () => {
  const clauses = [
    { field: "author", mode: "include", values: ["Ursula K. Le Guin"] },
  ];

  it("returns the clauses a page sent in router state", () => {
    expect(handoffClauses({ clauses })).toEqual(clauses);
  });

  it.each([
    ["no state", null],
    ["state without clauses", { from: "/authors" }],
    ["a clause the filter would refuse", { clauses: [{ field: "nope" }] }],
  ])("returns null for %s", (_condition, state) => {
    expect(handoffClauses(state)).toBeNull();
  });
});
