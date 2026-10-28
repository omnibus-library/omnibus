import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import JSZip from "jszip";

// Types and the in-memory book for the iOS reader glue lane (rule 04b): what
// the glue reports to the host, and the page globals `IosGluePage` drives.

/** A point in host-window coordinates, as the Swift host sends it. */
export interface Point {
  x: number;
  y: number;
}

/** Which way a turn goes: 1 is forward, -1 back. */
export type Direction = 1 | -1;

/** The `init` options the specs vary; the page supplies the rest. */
export interface GlueOptions {
  cfi?: string;
  lineHeight?: number;
  spread?: "none" | "auto";
  minSpreadWidth?: number;
}

/** Host calls `openBook` makes in the same tick as `init`, before any locations pass. */
export interface EarlyCalls {
  seek?: number;
  display?: string;
  /** Sent from the `ready` callback itself, as the host sends a held follow jump. */
  seekOnReady?: number;
}

/** What `emitRelocate` posts to `__omnibusOnRelocate`. */
export interface RelocatePayload {
  cfi: string;
  echo: boolean;
  pct: number;
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

/** What `whenSettled` resolves: what the host decides a curl by. */
export interface Settled {
  columns: number;
  spine: number | null;
  next: string;
  prev: string;
}

/** The page's globals a glue spec reads and writes. */
export interface GlueWindow {
  OmnibusReader: {
    init(elementId: string, fileUrl: string, opts: object): void;
    next(): void;
    seek(fraction: number): void;
    display(target: string): void;
    setSpread(mode: "none" | "auto"): void;
    beginSelectionAt(x: number, y: number): boolean;
    extendSelectionTo(x: number, y: number): void;
    endSelectionDrag(): void;
    turnSlide(dir: number): void;
    setCurlReady(on: boolean, next: boolean, prev: boolean): void;
    neighbourKind(dir: number): "page" | "section" | "none";
    whenSettled(): Promise<Settled>;
    peek(dir: number): Promise<boolean>;
    turnInstant(dir: number): Promise<boolean>;
  };
  ePub: { CFI: new (cfi: string) => { toRange(doc: Document): Range } };
  __omnibusOnSelection: (json: string) => void;
  __omnibusOnStatus: (state: string) => void;
  __omnibusOnRelocate: (json: string) => void;
  __omnibusOnTurnRequest: (dir: string) => void;
  glueSelections: SelectionPayload[];
  glueRelocates: RelocatePayload[];
  glueTurnRequests: string[];
  glueStatus: string | null;
}

/**
 * A one-chapter EPUB3 whose chapter body is `body`. `head` lands in every
 * chapter's `<head>`; `files` are extra `OEBPS/`-relative resources, each
 * listed in the manifest under the given media type, and left out of the zip
 * when its `data` is null; `toc` is the nav's `[label, href]` entries, one
 * "One" entry for the chapter by default. `chapters` are the bodies of
 * further spine items, `chapter2.xhtml` on.
 */
export async function buildChapterEpub(
  body: string,
  opts: {
    head?: string;
    files?: Record<string, { data: Buffer | string | null; mediaType: string }>;
    toc?: [string, string][];
    chapters?: string[];
  } = {},
): Promise<Buffer> {
  const files = opts.files ?? {};
  const more = (opts.chapters ?? []).map((chapterBody, i) => ({
    id: `ch${i + 2}`,
    href: `chapter${i + 2}.xhtml`,
    body: chapterBody,
  }));
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
    ${more.map((c) => `<item id="${c.id}" href="${c.href}" media-type="application/xhtml+xml"/>`).join("\n    ")}
    ${extra}
  </manifest>
  <spine><itemref idref="ch1"/>${more.map((c) => `<itemref idref="${c.id}"/>`).join("")}</spine>
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
  for (const c of more) {
    zip.file(
      `OEBPS/${c.href}`,
      `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>${c.id}</title>${opts.head ?? ""}</head>
<body>${c.body}</body>
</html>`,
    );
  }
  for (const [href, f] of Object.entries(files)) {
    if (f.data !== null) zip.file(`OEBPS/${href}`, f.data);
  }
  return zip.generateAsync({ type: "nodebuffer" });
}

/**
 * A font for a book to embed: the reader's own EB Garamond bytes, which a
 * book's sheet names under a family of its own.
 */
export const BOOK_FONT: Buffer = readFileSync(
  resolve(
    __dirname,
    "..",
    "..",
    "..",
    "..",
    "omnibus-ios",
    "omnibus",
    "Reader",
    "Web",
    "EBGaramond-Regular.woff2",
  ),
);

// Two images told apart by width, so a spec can see which file one loaded.
const PICTURE: Buffer = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAMAAAABCAIAAACUgoPjAAAADUlEQVR4nGPQm+sFQQAP8QNA7CBZpgAAAABJRU5ErkJggg==",
  "base64",
);
const DECOY: Buffer = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAcAAAABCAIAAACdaSOZAAAADUlEQVR4nGO4bKWDiQBizAiQdjVyvQAAAABJRU5ErkJggg==",
  "base64",
);

/** The width of the picture `bookWithSheetFont({ missingFile })` shows; its decoy's is 7. */
export const PICTURE_WIDTH = 3;

/**
 * A book in the shape Calibre gives one: the sheet in `styles/`, the chapters
 * a folder up, and the sheet embedding `font` from `fonts/` by a url()
 * relative to itself, for every paragraph in `family`. `twoChapters` adds a
 * second chapter, "Two", that links the sheet too. `missingFile` lists
 * `images/absent.png` first and leaves it out of the zip, as a book whose
 * manifest names a file it lacks does; the chapter shows it as `#absent`,
 * and `images/picture.png` as `#picture`, listed just ahead of a decoy.
 * `missingSheet` lists `styles/absent.css` ahead of the book's sheet and
 * leaves it out of the zip.
 */
export function bookWithSheetFont(opts: {
  family: string;
  font: Buffer;
  twoChapters?: boolean;
  missingFile?: boolean;
  missingSheet?: boolean;
}): Promise<Buffer> {
  const prose = Array.from(
    { length: 12 },
    (_, i) =>
      `<p>Paragraph ${i + 1} of the harbour, set in the book's face.</p>`,
  ).join("");
  const pictures = opts.missingFile
    ? '<p><img id="picture" src="images/picture.png" alt=""/><img id="absent" src="images/absent.png" alt=""/></p>'
    : "";
  const sheet = `@font-face { font-family: "${opts.family}"; src: url("../fonts/BookFace.woff2") format("woff2"); }
p { font-family: "${opts.family}", serif; }
`;
  return buildChapterEpub(pictures + prose, {
    head: '<link href="styles/book.css" rel="stylesheet" type="text/css"/>',
    ...(opts.twoChapters
      ? {
          chapters: [prose],
          toc: [
            ["One", "chapter.xhtml"],
            ["Two", "chapter2.xhtml"],
          ],
        }
      : {}),
    files: {
      ...(opts.missingFile
        ? {
            "images/absent.png": { data: null, mediaType: "image/png" },
            "images/picture.png": { data: PICTURE, mediaType: "image/png" },
            "images/decoy.png": { data: DECOY, mediaType: "image/png" },
          }
        : {}),
      ...(opts.missingSheet
        ? { "styles/absent.css": { data: null, mediaType: "text/css" } }
        : {}),
      "styles/book.css": { data: sheet, mediaType: "text/css" },
      "fonts/BookFace.woff2": { data: opts.font, mediaType: "font/woff2" },
    },
  });
}

/** Where a selection row ends, in host-window y. */
export const bottomOf = (row: SelectionRect): number => row.y + row.height;
