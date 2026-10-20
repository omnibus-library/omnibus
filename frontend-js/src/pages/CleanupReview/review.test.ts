import { describe, expect, it } from "vitest";
import type { CleanupAction, CleanupKind, SuggestionCard } from "../../api";
import {
  actionSentence,
  decideNote,
  dotState,
  initialValue,
  isEditable,
  kindTitle,
  proposedLabel,
  scannedLabel,
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
    expect(decideNote(edited, editable)).toBe(note);
  });
});
