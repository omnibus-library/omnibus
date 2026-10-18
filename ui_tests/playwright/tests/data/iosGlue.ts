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
 * A one-chapter EPUB3 whose chapter body is `body`. `head` lands in the
 * chapter's `<head>`; `files` are extra `OEBPS/`-relative resources, each
 * listed in the manifest under the given media type; `toc` is the nav's
 * `[label, href]` entries, one "One" entry for the chapter by default.
 * `chapters` are the bodies of further spine items, `chapter2.xhtml` on.
 */
export async function buildChapterEpub(
  body: string,
  opts: {
    head?: string;
    files?: Record<string, { data: Buffer | string; mediaType: string }>;
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
<head><title>${c.id}</title></head>
<body>${c.body}</body>
</html>`,
    );
  }
  for (const [href, f] of Object.entries(files)) {
    zip.file(`OEBPS/${href}`, f.data);
  }
  return zip.generateAsync({ type: "nodebuffer" });
}

/** Where a selection row ends, in host-window y. */
export const bottomOf = (row: SelectionRect): number => row.y + row.height;
