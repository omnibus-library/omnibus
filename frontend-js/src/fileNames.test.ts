import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("src module names", () => {
  it("never differ from another module's only by case", () => {
    // macOS's case-insensitive disk resolves `./Foo` to `foo.ts`; Linux CI tells them apart.
    const byName = new Map<string, string[]>();
    for (const file of readdirSync(import.meta.dirname, {
      recursive: true,
      encoding: "utf8",
    })) {
      if (!/\.tsx?$/.test(file)) continue;
      const name = file.replace(/\.tsx?$/, "").toLowerCase();
      byName.set(name, [...(byName.get(name) ?? []), file]);
    }

    expect([...byName.values()].filter((files) => files.length > 1)).toEqual(
      [],
    );
  });
});
