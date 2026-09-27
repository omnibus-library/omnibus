import { resolve } from "node:path";
import type { Page } from "@playwright/test";
import JSZip from "jszip";

import { expect, test } from "../fixtures/test";

// The text an iOS reader selection reports — what a highlight stores, and what
// Copy, Quote and the note composer are handed — driven through the native
// app's own glue rather than the web reader's.
//
// `omnibus-ios/omnibus/Reader/Web/` is not served by the web app, so this spec
// serves it itself, byte for byte off disk, on a routed origin, with an EPUB
// built in memory — see rule 04b. The public-domain fixtures carry no hidden
// markup to trip over; commercial and Calibre-converted books routinely do.

const ORIGIN = "http://ios-glue.test";
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

// Every shape of text the page never shows, each beside words it is welded to
// or sitting between two paragraphs a drag can span.
const CHAPTER = `
<p id="harbour">It was the sort of evening that made the harbour look like a<span class="pagenum" epub:type="pagebreak" id="page147">147</span> postcard.</p>
<style>.pagenum { display: none; }</style>
<p id="tide">The tide came in the way bad news does, quietly.</p>
<p id="quay">Nobody on the quay said a word about it.</p>
<div hidden="hidden">A publisher's note the page never shows.</div>
<script>/* left behind by a converter */</script>
<p id="road">Marlow went home by the long road.</p>
<p id="shore">They walked the shore<span class="pagenum">[Pg 12]</span> until dark.</p>
<p id="battle">The bat<span class="pagenum">[Pg 13]</span>tle was over by noon.</p>
<p id="page">The next <span class="pagenum">[Pg 14]</span>page began mid-sentence.</p>
<p id="veiled">A light <span style="visibility: hidden">148</span>burned on the point.</p>
<p id="over">It was over.</p><p id="home">Marlow went home.</p>
<p id="lines">The first line<br/>the second line</p>
`;

/** What `emitSelection` posts to `__omnibusOnSelection`. */
interface SelectionPayload {
  cfiRange: string | null;
  text: string;
  dragging: boolean;
}

/** The page's globals this spec reads and writes. */
interface GlueWindow {
  OmnibusReader: {
    init(elementId: string, fileUrl: string, opts: object): void;
    beginSelectionAt(x: number, y: number): boolean;
    extendSelectionTo(x: number, y: number): void;
    endSelectionDrag(): void;
  };
  ePub: { CFI: new (cfi: string) => { toRange(doc: Document): Range } };
  __omnibusOnSelection: (json: string) => void;
  __omnibusOnStatus: (state: string) => void;
  glueSelections: SelectionPayload[];
  glueStatus: string | null;
}

async function buildEpub(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file(
    "META-INF/container.xml",
    `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`,
  );
  zip.file(
    "OEBPS/content.opf",
    `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:uuid:2650-ios-glue</dc:identifier>
    <dc:title>The Harbour Light</dc:title>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ch1" href="chapter.xhtml" media-type="application/xhtml+xml"/>
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
<head><title>One</title></head>
<body>${CHAPTER}</body>
</html>`,
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

/** Serve the iOS reader page and open the book in it, as the Swift host does. */
async function openGlue(page: Page): Promise<void> {
  const epub = await buildEpub();
  await page.route(`${ORIGIN}/**`, (route) => {
    const file = new URL(route.request().url()).pathname.slice(1);
    if (file === "book.epub") {
      return route.fulfill({ body: epub, contentType: "application/epub+zip" });
    }
    if (GLUE_FILES.has(file)) {
      return route.fulfill({ path: resolve(GLUE_DIR, file) });
    }
    return route.fulfill({ status: 404 });
  });
  await page.goto(`${ORIGIN}/reader.html`);
  // The page's own callbacks post to a WKWebView message handler that is not
  // here; replace them with ones that keep what the glue reports.
  await page.evaluate(() => {
    const w = window as unknown as GlueWindow;
    w.glueSelections = [];
    w.glueStatus = null;
    w.__omnibusOnSelection = (json) => {
      w.glueSelections.push(JSON.parse(json));
    };
    w.__omnibusOnStatus = (state) => {
      w.glueStatus = state;
    };
    w.OmnibusReader.init("stage", "/book.epub", {
      theme: "light",
      fontSize: 18,
      spread: "none",
      allowScriptedContent: true,
    });
  });
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as GlueWindow).glueStatus),
    )
    .toBe("ready");
}

/** The centre of `word` in paragraph `id`, in host-window coordinates. */
function wordPoint(
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
async function dragSelect(
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

/** The last settled payload — the one a highlight is created from. */
async function settled(page: Page): Promise<SelectionPayload> {
  const all = await page.evaluate(
    () => (window as unknown as GlueWindow).glueSelections,
  );
  const last = all.filter((s) => !s.dragging).at(-1);
  if (!last) throw new Error("no settled selection was reported");
  return last;
}

/** The raw DOM text of the range a settled selection's CFI names. */
function rangeUnderCfi(page: Page, cfi: string): Promise<string> {
  return page.evaluate((cfi) => {
    const w = window as unknown as GlueWindow;
    const frame = document.querySelector<HTMLIFrameElement>("#stage iframe");
    const doc = frame?.contentDocument;
    if (!doc) throw new Error("no section document");
    return new w.ePub.CFI(cfi).toRange(doc).toString();
  }, cfi);
}

test.describe("iOS reader selection text", () => {
  // A phone-sized stage, as the host gives it.
  test.use({ viewport: { width: 402, height: 874 } });

  test.beforeEach(async ({ page }) => {
    await openGlue(page);
  });

  test("a drag across a hidden page break and an in-body stylesheet reports only the text on the page", async ({
    page,
  }) => {
    const from = await wordPoint(page, "harbour", "evening");
    const to = await wordPoint(page, "tide", "bad");

    await dragSelect(page, from, to);

    const selection = await settled(page);
    expect(selection.cfiRange).not.toBeNull();
    expect(selection.text).toBe(
      "evening that made the harbour look like a postcard. The tide came in the way bad",
    );
  });

  test("a drag across a hidden block and an in-body script reports only the text on the page", async ({
    page,
  }) => {
    const from = await wordPoint(page, "quay", "quay");
    const to = await wordPoint(page, "road", "long");

    await dragSelect(page, from, to);

    expect((await settled(page)).text).toBe(
      "quay said a word about it. Marlow went home by the long",
    );
  });

  test("a long press on a word welded to a hidden marker selects only the visible word", async ({
    page,
  }) => {
    await dragSelect(page, await wordPoint(page, "shore", "shore"));

    const selection = await settled(page);
    expect(selection.text).toBe("shore");
    // The range itself, not only its text: a token run into the marker would
    // report the same text and still anchor the highlight on `[Pg`.
    expect(await rangeUnderCfi(page, selection.cfiRange!)).toBe("shore");
  });

  test("a long press on a word a hidden marker splits selects the whole visible word", async ({
    page,
  }) => {
    await dragSelect(page, await wordPoint(page, "battle", "bat"));

    expect((await settled(page)).text).toBe("battle");
  });

  test("a long press on a word straight after a hidden marker starts the range at the word", async ({
    page,
  }) => {
    await dragSelect(page, await wordPoint(page, "page", "page"));

    const selection = await settled(page);
    expect(selection.text).toBe("page");
    expect(await rangeUnderCfi(page, selection.cfiRange!)).toBe("page");
  });

  test("text hidden by visibility is neither reported nor welded onto the word beside it", async ({
    page,
  }) => {
    await dragSelect(page, await wordPoint(page, "veiled", "burned"));

    const pressed = await settled(page);
    expect(pressed.text).toBe("burned");
    expect(await rangeUnderCfi(page, pressed.cfiRange!)).toBe("burned");

    const from = await wordPoint(page, "veiled", "light");
    const to = await wordPoint(page, "veiled", "point");
    await dragSelect(page, from, to);

    expect((await settled(page)).text).toBe("light burned on the point.");
  });

  test("a drag between paragraphs with no whitespace in the source reports a space where the line breaks", async ({
    page,
  }) => {
    const from = await wordPoint(page, "over", "was");
    const to = await wordPoint(page, "home", "went");

    await dragSelect(page, from, to);

    expect((await settled(page)).text).toBe("was over. Marlow went");
  });

  test("a line break parts the words either side of it", async ({ page }) => {
    await dragSelect(page, await wordPoint(page, "lines", "line"));

    const pressed = await settled(page);
    expect(pressed.text).toBe("line");
    expect(await rangeUnderCfi(page, pressed.cfiRange!)).toBe("line");

    const from = await wordPoint(page, "lines", "first");
    const to = await wordPoint(page, "lines", "second");
    await dragSelect(page, from, to);

    expect((await settled(page)).text).toBe("first line the second");
  });
});
