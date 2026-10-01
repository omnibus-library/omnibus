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
  chapterTitle: string;
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
  ePub: { CFI: new (cfi: string) => { toRange(doc: Document): Range } };
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
 * listed in the manifest under the given media type; `toc` is the nav's
 * `[label, href]` entries, one "One" entry for the chapter by default.
 */
export async function buildChapterEpub(
  body: string,
  opts: {
    head?: string;
    files?: Record<string, { data: Buffer | string; mediaType: string }>;
    toc?: [string, string][];
  } = {},
): Promise<Buffer> {
  const files = opts.files ?? {};
  const toc = (opts.toc ?? [["One", "chapter.xhtml"]])
    .map(([label, href]) => `<li><a href="${href}">${label}</a></li>`)
    .join("");
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
<body><nav epub:type="toc"><ol>${toc}</ol></nav></body>
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

/** The centre of `word` in element `id`, in host-window coordinates. */
export function wordPoint(
  page: Page,
  id: string,
  word: string,
): Promise<{ x: number; y: number }> {
  return page.evaluate(
    ([id, word]) => {
      const frame = document.querySelector<HTMLIFrameElement>("#stage iframe");
      const doc = frame?.contentDocument;
      const para = doc?.getElementById(id);
      if (!frame || !doc || !para) throw new Error(`no paragraph #${id}`);
      const walker = doc.createTreeWalker(para, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const at = (n as Text).data.indexOf(word);
        if (at < 0) continue;
        const range = doc.createRange();
        range.setStart(n, at);
        range.setEnd(n, at + word.length);
        const box = range.getBoundingClientRect();
        const off = frame.getBoundingClientRect();
        return {
          x: off.left + box.left + box.width / 2,
          y: off.top + box.top + box.height / 2,
        };
      }
      throw new Error(`no "${word}" in #${id}`);
    },
    [id, word] as const,
  );
}

/** Long-press `from`, drag to `to` (by the word), and lift. */
export async function dragSelect(
  page: Page,
  from: { x: number; y: number },
  to?: { x: number; y: number },
): Promise<void> {
  await page.evaluate(
    ([from, to]) => {
      const reader = (window as unknown as GlueWindow).OmnibusReader;
      if (!reader.beginSelectionAt(from.x, from.y)) {
        throw new Error("the press selected nothing");
      }
      if (to) reader.extendSelectionTo(to.x, to.y);
      reader.endSelectionDrag();
    },
    [from, to] as const,
  );
}

/** The last settled selection payload — the one a highlight is created from. */
export async function settled(page: Page): Promise<SelectionPayload> {
  const all = await page.evaluate(
    () => (window as unknown as GlueWindow).glueSelections,
  );
  const last = all.filter((s) => !s.dragging).at(-1);
  if (!last) throw new Error("no settled selection was reported");
  return last;
}
