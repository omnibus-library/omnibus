import { describe, expect, it } from "vitest";
import { scanBookFromHit } from "../api";
import { aWirePaletteBook } from "../testing/wire";

describe("scanBookFromHit", () => {
  const HIT = { ...aWirePaletteBook(), uuid: "u-1" };

  it("carries the hit's uuid", () => {
    expect(scanBookFromHit(HIT).uuid).toBe("u-1");
  });

  it("keeps a sort-form author display as one entry", () => {
    expect(
      scanBookFromHit({ ...HIT, author_display: "Weir, Andy" }).authors,
    ).toEqual(["Weir, Andy"]);
  });

  it("has no author entry when the display is blank", () => {
    expect(scanBookFromHit({ ...HIT, author_display: " " }).authors).toEqual(
      [],
    );
  });

  it("reads has_files from the hit formats", () => {
    expect(scanBookFromHit({ ...HIT, formats: ["EPUB"] }).has_files).toBe(true);
    expect(scanBookFromHit({ ...HIT, formats: [] }).has_files).toBe(false);
  });

  it("reads has_physical from the hit copy flag", () => {
    expect(scanBookFromHit({ ...HIT, has_physical: true }).has_physical).toBe(
      true,
    );
    expect(scanBookFromHit({ ...HIT, has_physical: false }).has_physical).toBe(
      false,
    );
  });
});
