import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repo = resolve(import.meta.dirname, "../../../..");
const copy = (path: string) => resolve(repo, "frontend-js", path);
const source = (path: string) => resolve(repo, "frontend/assets", path);

const files = [
  "jszip.min.js",
  "epub.min.js",
  "epub-reader-glue.js",
  "pdf-reader-glue.js",
  "pdf.min.mjs",
  "pdf.worker.min.mjs",
];

const directories = [
  ["public/vendor/pdfjs-wasm", "vendor/pdfjs-wasm"],
  ["public/reader-fonts", "reader-fonts"],
] as const;

describe("vendored reader runtime", () => {
  it.each(files)("holds %s as a byte copy of the Dioxus asset", (name) => {
    const vendored = readFileSync(copy(`src/vendor/reader/${name}`));

    expect(vendored.equals(readFileSync(source(`vendor/${name}`)))).toBe(true);
  });

  it.each(directories)(
    "holds %s as a byte copy of the Dioxus directory",
    (to, from) => {
      const names = readdirSync(source(from)).sort();

      expect(readdirSync(copy(to)).sort()).toEqual(names);
      for (const name of names) {
        const vendored = readFileSync(`${copy(to)}/${name}`);
        expect(vendored.equals(readFileSync(`${source(from)}/${name}`))).toBe(
          true,
        );
      }
    },
  );
});
