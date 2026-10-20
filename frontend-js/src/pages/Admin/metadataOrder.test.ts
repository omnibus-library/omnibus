import { describe, expect, it } from "vitest";
import type { MetadataSource } from "../../api";
import {
  changedOrder,
  focusAfterMove,
  moveSource,
  positionAnnouncement,
  saveSummary,
  sourceLabel,
} from "./metadataOrder";

const ORDER: MetadataSource[] = [
  "folder_structure",
  "embedded_tags",
  "opf_sidecar",
];

describe("moveSource", () => {
  it("swaps a source up and reports where it landed", () => {
    expect(moveSource(ORDER, 1, "up")).toEqual({
      order: ["embedded_tags", "folder_structure", "opf_sidecar"],
      landed: 0,
    });
  });

  it("swaps a source down and reports where it landed", () => {
    expect(moveSource(ORDER, 1, "down")).toEqual({
      order: ["folder_structure", "opf_sidecar", "embedded_tags"],
      landed: 2,
    });
  });

  it("leaves the order alone", () => {
    moveSource(ORDER, 1, "up");

    expect(ORDER).toEqual(["folder_structure", "embedded_tags", "opf_sidecar"]);
  });

  it.each([
    ["up from the top", 0, "up"],
    ["down from the bottom", 2, "down"],
  ] as const)("refuses to move %s", (_condition, from, direction) => {
    expect(moveSource(ORDER, from, direction)).toBeNull();
  });
});

describe("focusAfterMove", () => {
  it("keeps the pressed button while the source can still move that way", () => {
    expect(focusAfterMove(2, 5, "up")).toBe("up");
    expect(focusAfterMove(2, 5, "down")).toBe("down");
  });

  it("takes the other button once the source reaches the top", () => {
    expect(focusAfterMove(0, 5, "up")).toBe("down");
  });

  it("takes the other button once the source reaches the bottom", () => {
    expect(focusAfterMove(4, 5, "down")).toBe("up");
  });
});

describe("positionAnnouncement", () => {
  it("names the source and its new place", () => {
    expect(positionAnnouncement("opf_sidecar", 1, 5)).toBe(
      "OPF sidecar moved to position 2 of 5.",
    );
  });
});

describe("sourceLabel", () => {
  it.each([
    ["folder_structure", "Folder structure"],
    ["embedded_tags", "Embedded tags"],
    ["opf_sidecar", "OPF sidecar"],
    ["omnibus_overrides", "Manual edits (overrides)"],
    ["provider_match", "Provider match (Hardcover)"],
  ] as const)("names %s", (source, label) => {
    expect(sourceLabel(source)).toBe(label);
  });
});

describe("changedOrder", () => {
  const reordered = [...ORDER].reverse();

  it("returns the draft when it differs from the saved order", () => {
    expect(changedOrder(reordered, ORDER)).toEqual(reordered);
  });

  it("returns null for an order nobody touched", () => {
    expect(changedOrder([...ORDER], ORDER)).toBeNull();
  });

  it("returns null while the draft has not loaded", () => {
    expect(changedOrder(null, null)).toBeNull();
  });
});

describe("saveSummary", () => {
  it("reports success when every changed order saved", () => {
    expect(
      saveSummary([
        { library: "ebook", failure: null },
        { library: "audiobook", failure: null },
      ]),
    ).toEqual({ text: "Metadata order saved.", isError: false });
  });

  it("names the saved order beside the one the server refused", () => {
    expect(
      saveSummary([
        { library: "ebook", failure: null },
        { library: "audiobook", failure: "configure the library path first" },
      ]),
    ).toEqual({
      text: "Saved the ebook order. Couldn’t save the audiobook order: configure the library path first",
      isError: true,
    });
  });

  it("names every refusal when both orders fail", () => {
    expect(
      saveSummary([
        { library: "ebook", failure: "no" },
        { library: "audiobook", failure: "nope" },
      ]),
    ).toEqual({
      text: "Couldn’t save the ebook order: no Couldn’t save the audiobook order: nope",
      isError: true,
    });
  });
});
