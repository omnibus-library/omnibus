import { buildChapterEpub } from "../data/iosGlue";
import { expect, test } from "../fixtures/pageFixtures";

// Commercial and Calibre-converted books carry hidden markup the public-domain
// fixtures don't: every shape of text the page never shows, welded to words or
// sitting between two paragraphs a drag can span.
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

// What an iOS reader selection reports is what a highlight stores and what
// Copy, Quote and the note composer are handed.
test.describe("ios reader selection text", () => {
  // A phone-sized stage, as the host gives it.
  test.use({ viewport: { width: 402, height: 874 } });

  test.beforeEach(
    "open a chapter full of hidden markup",
    async ({ iosGluePage }) => {
      await iosGluePage.openBook(await buildChapterEpub(CHAPTER));
    },
  );

  test("report only the text on the page for a drag across a hidden page break and an in-body stylesheet", async ({
    iosGluePage,
  }) => {
    await test.step("drag from evening to bad", async () => {
      await iosGluePage.dragSelect(
        await iosGluePage.wordPoint("harbour", "evening"),
        await iosGluePage.wordPoint("tide", "bad"),
      );
    });

    await test.step("check the selection reports only the visible text", async () => {
      const selection = await iosGluePage.settledSelection();
      expect(selection.cfiRange).not.toBeNull();
      expect(selection.text).toBe(
        "evening that made the harbour look like a postcard. The tide came in the way bad",
      );
    });
  });

  test("report only the text on the page for a drag across a hidden block and an in-body script", async ({
    iosGluePage,
  }) => {
    await test.step("drag from quay to long", async () => {
      await iosGluePage.dragSelect(
        await iosGluePage.wordPoint("quay", "quay"),
        await iosGluePage.wordPoint("road", "long"),
      );
    });

    await test.step("check the selection reports only the visible text", async () => {
      expect((await iosGluePage.settledSelection()).text).toBe(
        "quay said a word about it. Marlow went home by the long",
      );
    });
  });

  test("select only the visible word on a long press on a word welded to a hidden marker", async ({
    iosGluePage,
  }) => {
    await test.step("long press shore", async () => {
      await iosGluePage.dragSelect(
        await iosGluePage.wordPoint("shore", "shore"),
      );
    });

    await test.step("check the selection is the visible word", async () => {
      const selection = await iosGluePage.settledSelection();
      expect(selection.text).toBe("shore");
      // The range itself, not only its text: a token run into the marker would
      // report the same text and still anchor the highlight on `[Pg`.
      expect(await iosGluePage.rangeText(selection.cfiRange!)).toBe("shore");
    });
  });

  test("select the whole visible word on a long press on a word a hidden marker splits", async ({
    iosGluePage,
  }) => {
    await test.step("long press bat", async () => {
      await iosGluePage.dragSelect(
        await iosGluePage.wordPoint("battle", "bat"),
      );
    });

    await test.step("check the selection is the whole word", async () => {
      expect((await iosGluePage.settledSelection()).text).toBe("battle");
    });
  });

  test("start the range at the word on a long press on a word straight after a hidden marker", async ({
    iosGluePage,
  }) => {
    await test.step("long press page", async () => {
      await iosGluePage.dragSelect(await iosGluePage.wordPoint("page", "page"));
    });

    await test.step("check the range starts at the word", async () => {
      const selection = await iosGluePage.settledSelection();
      expect(selection.text).toBe("page");
      expect(await iosGluePage.rangeText(selection.cfiRange!)).toBe("page");
    });
  });

  test("select only the visible word beside text hidden by visibility", async ({
    iosGluePage,
  }) => {
    await test.step("long press burned", async () => {
      await iosGluePage.dragSelect(
        await iosGluePage.wordPoint("veiled", "burned"),
      );
    });

    await test.step("check the hidden text is not welded onto the word", async () => {
      const pressed = await iosGluePage.settledSelection();
      expect(pressed.text).toBe("burned");
      expect(await iosGluePage.rangeText(pressed.cfiRange!)).toBe("burned");
    });
  });

  test("report only the visible text for a drag across text hidden by visibility", async ({
    iosGluePage,
  }) => {
    await test.step("drag from light to point", async () => {
      await iosGluePage.dragSelect(
        await iosGluePage.wordPoint("veiled", "light"),
        await iosGluePage.wordPoint("veiled", "point"),
      );
    });

    await test.step("check the hidden text is not reported", async () => {
      expect((await iosGluePage.settledSelection()).text).toBe(
        "light burned on the point.",
      );
    });
  });

  test("report a space where the line breaks for a drag between paragraphs with no whitespace in the source", async ({
    iosGluePage,
  }) => {
    await test.step("drag from was to went", async () => {
      await iosGluePage.dragSelect(
        await iosGluePage.wordPoint("over", "was"),
        await iosGluePage.wordPoint("home", "went"),
      );
    });

    await test.step("check a space parts the paragraphs", async () => {
      expect((await iosGluePage.settledSelection()).text).toBe(
        "was over. Marlow went",
      );
    });
  });

  test("select only the word beside a line break on a long press", async ({
    iosGluePage,
  }) => {
    await test.step("long press line", async () => {
      await iosGluePage.dragSelect(
        await iosGluePage.wordPoint("lines", "line"),
      );
    });

    await test.step("check the break parts the word from its neighbours", async () => {
      const pressed = await iosGluePage.settledSelection();
      expect(pressed.text).toBe("line");
      expect(await iosGluePage.rangeText(pressed.cfiRange!)).toBe("line");
    });
  });

  test("part the words either side of a line break for a drag across it", async ({
    iosGluePage,
  }) => {
    await test.step("drag from first to second", async () => {
      await iosGluePage.dragSelect(
        await iosGluePage.wordPoint("lines", "first"),
        await iosGluePage.wordPoint("lines", "second"),
      );
    });

    await test.step("check a space parts the words", async () => {
      expect((await iosGluePage.settledSelection()).text).toBe(
        "first line the second",
      );
    });
  });

  test("keep a floated drop cap in its word", async ({ iosGluePage }) => {
    await test.step("long press he", async () => {
      await iosGluePage.dragSelect(
        await iosGluePage.wordPoint("dropcap", "he"),
      );
    });

    await test.step("check the cap does not split the word", async () => {
      expect((await iosGluePage.settledSelection()).text).toBe("The");
    });
  });

  test("select the whole word across a hidden line break", async ({
    iosGluePage,
  }) => {
    await test.step("long press foot", async () => {
      await iosGluePage.dragSelect(await iosGluePage.wordPoint("foot", "foot"));
    });

    await test.step("check the hidden break does not part the word", async () => {
      expect((await iosGluePage.settledSelection()).text).toBe("football");
    });
  });
});
