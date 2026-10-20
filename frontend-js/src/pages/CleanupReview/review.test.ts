import { describe, expect, it } from "vitest";
import type { CleanupAction, CleanupKind, SuggestionCard } from "../../api";
import {
  actionSentence,
  appliedSummary,
  decideNote,
  dotState,
  editedValue,
  initialValue,
  isEditable,
  kindTitle,
  proposedLabel,
  reviewKeyAction,
  scannedLabel,
  tallyRows,
} from "./review";

function card(
  kind: CleanupKind,
  action: CleanupAction,
  overrides: Partial<SuggestionCard> = {},
): SuggestionCard {
  return {
    id: 1,
    kind,
    action,
    decision: "pending",
    primary_name: "Mary Shelley",
    secondary_name: "Shelley, Mary W.",
    source_names: ["Shelley, Mary W."],
    proposed_parts: [],
    book_count: 3,
    photo_url: null,
    created_at: 0,
    ...overrides,
  };
}

describe("kindTitle", () => {
  it.each([
    ["author", "Review authors"],
    ["series", "Review series"],
    ["tag", "Review tags"],
    ["book_title", "Review book titles"],
  ] as const)("names the %s queue", (kind, title) => {
    expect(kindTitle(kind)).toBe(title);
  });

  it("falls back for an unknown kind", () => {
    expect(kindTitle(null)).toBe("Review library cleanup");
  });
});

describe("isEditable", () => {
  it("is true for a book-title rename", () => {
    expect(isEditable(card("book_title", "rename"))).toBe(true);
  });

  it.each([
    ["an author merge", card("author", "merge")],
    ["a tag split", card("tag", "split")],
    ["an author delete", card("author", "delete")],
    ["a series rename", card("series", "rename")],
    ["a book-title merge", card("book_title", "merge")],
  ])("is false for %s", (_condition, suggestion) => {
    expect(isEditable(suggestion)).toBe(false);
  });
});

describe("initialValue", () => {
  it("is the proposed title for a rename", () => {
    expect(
      initialValue(
        card("book_title", "rename", { secondary_name: "Frankenstein" }),
      ),
    ).toBe("Frankenstein");
  });

  it("is empty for a rename that proposes nothing", () => {
    expect(
      initialValue(card("book_title", "rename", { secondary_name: null })),
    ).toBe("");
  });

  it("is the surviving name for any other action", () => {
    expect(initialValue(card("author", "merge"))).toBe("Mary Shelley");
  });
});

describe("actionSentence", () => {
  it.each([
    ["author", "merge", "Merge these authors into one."],
    ["author", "delete", "Delete this author record."],
    ["series", "merge", "Merge these series into one."],
    ["tag", "merge", "Merge these tags into one."],
    ["tag", "split", "Split this tag into its parts."],
    ["book_title", "rename", "Adopt the normalized title."],
  ] as const)("describes %s %s", (kind, action, sentence) => {
    expect(actionSentence(kind, action)).toBe(sentence);
  });

  it("still reads a sentence for a pair no detector produces", () => {
    expect(actionSentence("series", "delete")).toBe("Apply this cleanup.");
  });
});

describe("scannedLabel", () => {
  it.each([
    ["rename", "Scanned title"],
    ["split", "Scanned tag"],
    ["delete", "Record"],
    ["merge", "Merging away"],
  ] as const)("labels a %s", (action, label) => {
    expect(scannedLabel(action)).toBe(label);
  });
});

describe("proposedLabel", () => {
  it.each([
    ["rename", "Proposed title"],
    ["split", "Splits into"],
    ["merge", "Surviving name"],
  ] as const)("labels a %s", (action, label) => {
    expect(proposedLabel(action)).toBe(label);
  });
});

describe("dotState", () => {
  it.each([
    ["a card already passed", 0, 2, "done"],
    ["the card under review", 2, 2, "on"],
    ["a card still ahead", 3, 2, ""],
  ])("marks %s", (_condition, slot, index, state) => {
    expect(dotState(slot, index)).toBe(state);
  });
});

describe("decideNote", () => {
  it.each([
    ["an edited title", true, true, "your wording replaces the proposal"],
    [
      "an editable title left as detected",
      false,
      true,
      "accepting applies at once · you can undo it",
    ],
    ["a card with nothing to edit", false, false, "accepting applies at once"],
  ])("reads %s", (_condition, edited, editable, note) => {
    expect(decideNote({ edited, editable })).toBe(note);
  });
});

describe("reviewKeyAction", () => {
  it.each([
    ["y", "accept"],
    ["Y", "accept"],
    ["n", "reject"],
    ["N", "reject"],
    [" ", "skip"],
  ] as const)("maps %j to %s", (key, action) => {
    expect(reviewKeyAction(key)).toBe(action);
  });

  it.each(["q", "Enter", "Escape", "Tab", "ArrowRight", "yy"])(
    "maps %j to nothing",
    (key) => {
      expect(reviewKeyAction(key)).toBeNull();
    },
  );
});

describe("editedValue", () => {
  const rename = () =>
    card("book_title", "rename", { secondary_name: "Frankenstein" });

  it("is null while the draft still reads as detected", () => {
    expect(editedValue(rename(), "Frankenstein")).toBeNull();
  });

  it("carries the reviewer's wording once it differs", () => {
    expect(
      editedValue(rename(), "Frankenstein; or, The Modern Prometheus"),
    ).toBe("Frankenstein; or, The Modern Prometheus");
  });

  it("is null for a kind that cannot carry one, whatever the draft says", () => {
    expect(editedValue(card("author", "merge"), "Someone Else")).toBeNull();
  });
});

describe("appliedSummary", () => {
  it.each([
    [
      "a merge",
      card("author", "merge"),
      "Mary Shelley",
      "Merged into \u201cMary Shelley\u201d.",
    ],
    [
      "a rename",
      card("book_title", "rename"),
      "Frankenstein; or, The Modern Prometheus",
      "Renamed to \u201cFrankenstein; or, The Modern Prometheus\u201d.",
    ],
    [
      "a split",
      card("tag", "split", { primary_name: "Fiction; Poland" }),
      "",
      "Split \u201cFiction; Poland\u201d.",
    ],
    [
      "a delete",
      card("author", "delete", { primary_name: "calibre (0.7.23)" }),
      "",
      "Deleted \u201ccalibre (0.7.23)\u201d.",
    ],
  ])("names what %s changed", (_condition, suggestion, value, summary) => {
    expect(appliedSummary(suggestion, value)).toBe(summary);
  });
});

describe("tallyRows", () => {
  const NOTHING = {
    accepted: 0,
    acceptedEdited: 0,
    rejected: 0,
    skipped: 0,
    undone: 0,
  };

  it("lists nothing for a pass that did nothing", () => {
    expect(tallyRows(NOTHING)).toEqual([]);
  });

  it("lists only the rows that happened, in the page's order", () => {
    expect(
      tallyRows({ ...NOTHING, undone: 1, accepted: 2, skipped: 4 }),
    ).toEqual([
      { count: 2, label: "accepted as proposed" },
      { count: 4, label: "skipped \u2014 comes back next pass" },
      { count: 1, label: "undone" },
    ]);
  });

  it("names every row", () => {
    expect(
      tallyRows({
        accepted: 1,
        acceptedEdited: 1,
        rejected: 1,
        skipped: 1,
        undone: 1,
      }).map((row) => row.label),
    ).toEqual([
      "accepted as proposed",
      "accepted with your wording",
      "rejected",
      "skipped \u2014 comes back next pass",
      "undone",
    ]);
  });
});
