import type { Page } from "@playwright/test";

import { expect, test } from "../fixtures/test";
import {
  buildChapterEpub,
  dragSelect,
  type GlueWindow,
  openGlue,
  settled,
  wordPoint,
} from "../utils/ios_glue";

// The text an iOS reader selection reports — what a highlight stores, and what
// Copy, Quote and the note composer are handed — driven through the native
// app's own glue rather than the web reader's.
//
// `omnibus-ios/omnibus/Reader/Web/` is not served by the web app, so this spec
// serves it itself, byte for byte off disk, on a routed origin, with an EPUB
// built in memory — see rule 04b. The public-domain fixtures carry no hidden
// markup to trip over; commercial and Calibre-converted books routinely do.

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
<div id="dropcap"><div style="float: left">T</div>he sea rose over the wall.</div>
<p id="foot">The foot<br class="pagenum"/>ball went long.</p>
`;

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
    await openGlue(page, await buildChapterEpub(CHAPTER));
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

  test("a block the page sets in the line, like a floated drop cap, does not split its word", async ({
    page,
  }) => {
    await dragSelect(page, await wordPoint(page, "dropcap", "he"));

    expect((await settled(page)).text).toBe("The");
  });

  test("a hidden line break parts nothing", async ({ page }) => {
    await dragSelect(page, await wordPoint(page, "foot", "foot"));

    expect((await settled(page)).text).toBe("football");
  });
});
