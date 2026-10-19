import { describe, expect, it } from "vitest";
import { scanBookFromHit } from "../api";
import { aWirePaletteBook } from "../testing/wire";

describe("scanBookFromHit", () => {
  const HIT = { ...aWirePaletteBook(), uuid: "u-1" };

  it("keeps the author display as one entry, a sort-form name included", () => {
    expect(
      scanBookFromHit({ ...HIT, author_display: "Weir, Andy" }).authors,
    ).toEqual(["Weir, Andy"]);
  });

  it("has no author entry when the display is blank", () => {
    expect(scanBookFromHit({ ...HIT, author_display: " " }).authors).toEqual(
      [],
    );
  });

  it("reads files from the formats and the copy flag from the hit", () => {
    expect(scanBookFromHit({ ...HIT, formats: ["EPUB"] })).toMatchObject({
      uuid: "u-1",
      has_files: true,
      has_physical: false,
    });
    expect(
      scanBookFromHit({ ...HIT, formats: [], has_physical: true }),
    ).toMatchObject({ has_files: false, has_physical: true });
  });
});
