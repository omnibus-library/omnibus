import { resolve } from "node:path";
import type { Page } from "@playwright/test";
import JSZip from "jszip";

import { expect } from "../fixtures/test";

// Harness for the iOS reader glue lane (rule 04b): `reader.html` and its
// scripts served byte for byte off disk on a routed origin, a book built in
// memory, and the host callbacks replaced with recorders.

export const GLUE_ORIGIN = "http://ios-glue.test";
const GLUE_DIR = resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "omnibus-ios",
  "omnibus",
  "Reader",
  "Web",
);
const GLUE_FILES = new Set([
  "reader.html",
  "jszip.min.js",
  "epub.min.js",
  "epub-reader-glue.js",
]);

/** What `emitRelocate` posts to `__omnibusOnRelocate`. */
export interface RelocatePayload {
  cfi: string;
  echo: boolean;
}

/** One host-window row the host paints a selection bar over. */
export interface SelectionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What `emitSelection` posts to `__omnibusOnSelection`. */
export interface SelectionPayload {
  cfiRange: string | null;
  text: string;
  rects: SelectionRect[];
  dragging: boolean;
}

/** The page's globals a glue spec reads and writes. */
export interface GlueWindow {
  OmnibusReader: {
    init(elementId: string, fileUrl: string, opts: object): void;
    next(): void;
    beginSelectionAt(x: number, y: number): boolean;
    extendSelectionTo(x: number, y: number): void;
    endSelectionDrag(): void;
  };
  __omnibusOnSelection: (json: string) => void;
  __omnibusOnStatus: (state: string) => void;
  __omnibusOnRelocate: (json: string) => void;
  glueSelections: SelectionPayload[];
  glueRelocates: RelocatePayload[];
  glueStatus: string | null;
}

/**
 * A one-chapter EPUB3 whose chapter body is `body`. `head` lands in the
 * chapter's `<head>`; `files` are extra `OEBPS/`-relative resources, each
 * listed in the manifest under the given media type.
 */
export async function buildChapterEpub(
  body: string,
  opts: {
    head?: string;
    files?: Record<string, { data: Buffer | string; mediaType: string }>;
  } = {},
): Promise<Buffer> {
  const files = opts.files ?? {};
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file(
    "META-INF/container.xml",
    `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`,
  );
  const extra = Object.entries(files)
    .map(
      ([href, f], i) =>
        `<item id="extra${i}" href="${href}" media-type="${f.mediaType}"/>`,
    )
    .join("\n    ");
  zip.file(
    "OEBPS/content.opf",
    `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:uuid:ios-glue-harness</dc:identifier>
    <dc:title>The Harbour Light</dc:title>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ch1" href="chapter.xhtml" media-type="application/xhtml+xml"/>
    ${extra}
  </manifest>
  <spine><itemref idref="ch1"/></spine>
</package>`,
  );
  zip.file(
    "OEBPS/nav.xhtml",
    `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Contents</title></head>
<body><nav epub:type="toc"><ol><li><a href="chapter.xhtml">One</a></li></ol></nav></body>
</html>`,
  );
  zip.file(
    "OEBPS/chapter.xhtml",
    `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>One</title>${opts.head ?? ""}</head>
<body>${body}</body>
</html>`,
  );
  for (const [href, f] of Object.entries(files)) {
    zip.file(`OEBPS/${href}`, f.data);
  }
  return zip.generateAsync({ type: "nodebuffer" });
}

/**
 * Serve the iOS reader page and open `epub` in it, as the Swift host does,
 * with every callback a spec reads recording onto `window`. Resolves once the
 * glue reports `ready`.
 */
export async function openGlue(
  page: Page,
  epub: Buffer,
  opts: Record<string, unknown> = {},
): Promise<void> {
  await page.route(`${GLUE_ORIGIN}/**`, (route) => {
    const file = new URL(route.request().url()).pathname.slice(1);
    if (file === "book.epub") {
      return route.fulfill({ body: epub, contentType: "application/epub+zip" });
    }
    if (GLUE_FILES.has(file)) {
      return route.fulfill({ path: resolve(GLUE_DIR, file) });
    }
    return route.fulfill({ status: 404 });
  });
  await page.goto(`${GLUE_ORIGIN}/reader.html`);
  // The page's own callbacks post to a WKWebView message handler that is not
  // here; replace them with ones that keep what the glue reports.
  await page.evaluate((opts) => {
    const w = window as unknown as GlueWindow;
    w.glueSelections = [];
    w.glueRelocates = [];
    w.glueStatus = null;
    w.__omnibusOnSelection = (json) => {
      w.glueSelections.push(JSON.parse(json));
    };
    w.__omnibusOnRelocate = (json) => {
      w.glueRelocates.push(JSON.parse(json));
    };
    w.__omnibusOnStatus = (state) => {
      w.glueStatus = state;
    };
    w.OmnibusReader.init("stage", "/book.epub", {
      theme: "light",
      fontSize: 18,
      spread: "none",
      allowScriptedContent: true,
      ...opts,
    });
  }, opts);
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as GlueWindow).glueStatus),
    )
    .toBe("ready");
}

/** Every relocate the glue has reported so far. */
export function relocates(page: Page): Promise<RelocatePayload[]> {
  return page.evaluate(() => (window as unknown as GlueWindow).glueRelocates);
}
