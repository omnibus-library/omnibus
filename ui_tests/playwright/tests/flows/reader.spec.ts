import type { Page } from "@playwright/test";
import { TYPEFACES } from "../components/ReaderDisplayPanelComponent";
import { highlights } from "../contracts/highlights";
import { progress } from "../contracts/progress";
import { FIXTURE_BOOKS } from "../fixtures/epubs";
import { expect, test } from "../fixtures/pageFixtures";
import { buildSubfolderNavEpub } from "../fixtures/subfolder_nav_epub";
import { expectMutation } from "../utils/api";
import { fetchBookUuidByTitle } from "../utils/ebooks";
import { gotoReady } from "../utils/nav";
import { storedProgress } from "../utils/progress";
import { fixturesDir, seedLibrary } from "../utils/seed";

// Re-seed in this spec's beforeAll so the running server is indexed against
// the committed EPUB fixtures before any assertion runs — independent of
// whatever other specs in the same worker did before us.
test.beforeAll(async ({ request }) => {
  await seedLibrary(request, fixturesDir(), FIXTURE_BOOKS.length);
});

// A fixture with predictable, distinctive metadata to drive most tests.
const TARGET = FIXTURE_BOOKS.find((b) => b.slug === "alpha")!;
// One book per highlight test, so no seeded highlight reaches TARGET's empty
// state or another test's drawer.
const HL_BOOK = FIXTURE_BOOKS.find((b) => b.slug === "beta")!;
const NOTE_BOOK = FIXTURE_BOOKS.find((b) => b.slug === "gamma")!;
const RECOLOR_BOOK = FIXTURE_BOOKS.find((b) => b.slug === "pioneers-3")!;
// A fifth book, reserved for the highlight-overlay regression: it asserts on
// where the highlight SVG is painted, so no other spec may write highlights
// or drive typography on it.
const OVERLAY_BOOK = FIXTURE_BOOKS.find((b) => b.slug === "standalone-river")!;
// Reserved books for the progress-restore tests (see fixtures/epubs.ts):
// saved position is per-book state on the shared server, so any other spec
// opening these in the reader would race the restore assertions. They must
// be real multi-page books (public-domain fixtures) — the synthetic
// one-paragraph EPUBs render as a single page with no page turns.
const PROGRESS_BOOK = FIXTURE_BOOKS.find((b) => b.slug === "frankenstein")!;
const PROGRESS_ERR_BOOK = FIXTURE_BOOKS.find((b) => b.slug === "great-gatsby")!;
// Reserved for the `?cfi=` deep-link test — book detail's saved-passages list
// opens the reader that way. Same isolation rationale as the two above (the
// test drives and reads saved position) and the same multi-page requirement.
// Deliberately one of the *smaller* public-domain fixtures: this test opens
// the book twice, and epub.js regenerates whole-book locations on the first
// cold open (later opens hit the localStorage cache). On a fresh CI shard a
// large fixture blows the pagination poll before a single page turn lands.
const DEEP_LINK_BOOK = FIXTURE_BOOKS.find(
  (b) => b.slug === "romeo-and-juliet",
)!;
// Reserved for the percent-only restore test (#2446): it stores a position
// with a percent and no CFI — a Kobo's shape — and asserts the open leaves it
// untouched, so no other spec may open it in the reader or write its
// position. A small multi-page book, for the same cold-open reason as above.
const PERCENT_ONLY_BOOK = FIXTURE_BOOKS.find(
  (b) => b.slug === "picture-of-dorian-gray",
)!;
// A multi-chapter book, so the contents drawer has rows to jump between. The
// subfolder test opens its uuid too, but stubs the file and progress routes.
const TOC_JUMP_BOOK = FIXTURE_BOOKS.find((b) => b.slug === "dracula")!;
// Two entries in Dracula's contents drawer.
const CHAPTER_ONE = "CHAPTER I JONATHAN HARKER’S JOURNAL";
const CHAPTER_FOUR = "CHAPTER IV JONATHAN HARKER’S JOURNAL—continued";
// Reserved for the paging-race / blank-front-matter regression (issue
// #1895) — five one-page sections (two full-page images, three text) ahead
// of chapter1, so paging through it repeatedly crosses section boundaries.
const FRONTMATTER_BOOK = FIXTURE_BOOKS.find(
  (b) => b.slug === "frontmatter-relay",
)!;
// Reserved for the CSP blob-stylesheet regression (issue #2213): its
// publisher.css references an embedded asset via a relative url(), so epub.js
// mints a blob: stylesheet on render — the one fixture that exercises the
// `style-src blob:` CSP path. No other spec may open it in the reader.
const BLOB_CSS_BOOK = FIXTURE_BOOKS.find((b) => b.slug === "standalone-reef")!;
// Reserved for the typeface tests below: the one fixture whose publisher CSS
// embeds a font and applies it at element level, so "Original keeps the
// publisher's face / a named face beats it" is assertable at all. No other
// spec may open it in the reader. The three tests here share it safely —
// they only read it and assert nothing server-side.
const FONT_BOOK = FIXTURE_BOOKS.find((b) => b.slug === "standalone-lagoon")!;
// Reserved for the two-finger gesture test: it parks a position and asserts
// nothing moved it, so no other spec may write this book's position. Small,
// for the cold-open reason on DEEP_LINK_BOOK above.
const TWO_FINGER_BOOK = FIXTURE_BOOKS.find((b) => b.slug === "mariucha")!;
// Reserved for the page-turn gutter test, which opens it at a deep link and
// reads layout alone; nothing else opens it.
const GUTTER_BOOK = FIXTURE_BOOKS.find((b) => b.slug === "room-with-a-view")!;
// A paragraph a third of the way into its Chapter II, so a spread of drift
// either way still has prose on both pages. Not the chapter's own element
// (`/6/10!/4/2`): epub.js orders an element before every point inside it, so
// the open's nudge read Chapter II's first page as past the target and turned
// back onto Chapter I's last spread — prose on the left page only.
const GUTTER_CFI = "epubcfi(/6/10!/4/2/92/1:0)";
// Its front matter and first eight chapters share one spine document, so only
// anchors tell them apart.
const SHARED_SPINE_BOOK = FIXTURE_BOOKS.find((b) => b.slug === "moby-dick")!;
// Mid-way through "CHAPTER 1. Loomings.": the last anchor would name Chapter 8.
const SHARED_SPINE_CFI = "epubcfi(/6/4!/4/50/1:0)";

// The epub.js progress POST fires on the reader's relocate events; pin the
// exact pathname so the sibling `/api/rpc/progress/get` reads never match.
const PROGRESS_POST = {
  method: "POST" as const,
  url: /\/api\/rpc\/progress(?:\?|$)/,
  expectedStatus: 200,
};

// The bottom-bar page label ("p. 3 of 12 · 25%" — or "· ~25%" while the
// whole-book pagination still resolves in the background, issue #1896)
// renders once epub.js has painted and the first relocate landed — the
// signal that relocates are flowing. Note the NBSP after "p." in the label.
const PAGE_LABEL = /p\.\u00a0\d+ of \d+/;

async function footerPageLabel(page: Page): Promise<string> {
  const text = (await page.getByTestId("reader-footer").textContent()) ?? "";
  const m = text.match(PAGE_LABEL);
  return m ? m[0] : "";
}

// "Ch\u00a03 of 24" from the footer — which chapter the reader is in.
async function chapterCounter(page: Page): Promise<string> {
  return (
    (await page.getByTestId("reader-chapter-counter").textContent()) ?? ""
  ).trim();
}

// The page number out of a footer label ("p.\u00a012 of 845" -> 12).
function footerPageNumber(label: string): number {
  const m = label.match(/\d+/);
  return m ? Number(m[0]) : Number.NaN;
}

// One finger in the forward gutter — how a touch reader turns the page, and
// the only way in a touch context: the round page-turn buttons are suppressed
// there in favour of tap and swipe.
async function tapForward(page: Page): Promise<void> {
  const size = page.viewportSize();
  if (!size) throw new Error("tapForward needs a viewport");
  await page.touchscreen.tap(size.width * 0.92, size.height / 2);
}

// Every `style.transform` left on a page view. `setViewOffset` writes the
// drag offset there, so a non-empty list after a gesture is a page stranded
// part-turned — invisible to the page label, which is why it is read directly.
async function strandedOffsets(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const mount = document.querySelector('[data-testid="reader-viewer"]');
    const container = mount?.querySelector("div");
    // Thrown, not reported as an offset: returned, it would satisfy the
    // "a drag was armed" control below and surface as a confusing failure
    // two assertions later.
    if (!container) throw new Error("no page container under reader-viewer");
    return Array.from(container.children)
      .map((child) => (child as HTMLElement).style.transform)
      .filter((transform) => transform !== "" && transform !== "none");
  });
}

// Let one animation frame run. The drag offset is applied in a rAF callback,
// so touch points dispatched back to back never paint one — and a test that
// skipped the frame would be asserting about a transform that was never
// written. Not a sleep: it resolves on the frame itself.
async function nextFrame(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );
}

// A one-finger drag that a second finger joins from *another document* — a
// finger on the page, then one on the top bar. Chromium keeps the sequence
// with the first touch's document and drops the second finger's `touchstart`
// there, so that handler learns it had company only from a lift reporting a
// finger still down.
// Returns the offsets standing mid-drag, so a caller can prove the drag it
// is about to interrupt was armed at all — without that, a gesture that
// quietly failed to arm one asserts nothing on the way out.
async function dragJoinedFromElsewhere(
  page: Page,
  onPage: { x: number; y: number },
  elsewhere: { x: number; y: number },
): Promise<string[]> {
  const cdp = await page.context().newCDPSession(page);
  const first = (dx: number) => ({ x: onPage.x + dx, y: onPage.y, id: 1 });
  const second = { x: elsewhere.x, y: elsewhere.y, id: 2 };
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [first(0)],
  });
  for (const dx of [-20, -45, -70]) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [first(dx)],
    });
    await nextFrame(page);
  }
  const armed = await strandedOffsets(page);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [first(-70), second],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [first(-70)],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await cdp.detach();
  return armed;
}

// Two fingers that the system takes away mid-gesture — a Control Center pull,
// a call — which arrives as `touchcancel` rather than a lift.
async function twoFingerCancel(
  page: Page,
  from: { x: number; y: number },
): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const points = (dy: number) => [
    { x: from.x, y: from.y + dy, id: 1 },
    { x: from.x + 36, y: from.y + 6 + dy, id: 2 },
  ];
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: points(0),
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: points(12),
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchCancel",
    touchPoints: [],
  });
  await cdp.detach();
}

// Two fingers land together, slide, and lift one at a time — what a hand
// actually does, and what the reader's gesture handling has to survive.
// Playwright's touchscreen drives one point, so the sequence goes through
// CDP; the suite is Chromium-only (see playwright.config.ts).
async function twoFingerSwipe(
  page: Page,
  from: { x: number; y: number },
  by: { x: number; y: number },
): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const points = (f: number) => [
    { x: from.x + by.x * f, y: from.y + by.y * f, id: 1 },
    { x: from.x + 36 + by.x * f, y: from.y + 6 + by.y * f, id: 2 },
  ];
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: points(0),
  });
  for (let step = 1; step <= 3; step++) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: points(step / 6),
    });
  }
  // The first finger leaves while the second is still travelling — the half
  // of the gesture the defect lived in.
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [points(0.5)[0]!],
  });
  for (let step = 4; step <= 6; step++) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [points(step / 6)[1]!],
    });
  }
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await cdp.detach();
}

// Intentional exception to the "never assert on rendered EPUB text" rule (same
// rationale as the black-theme regression below): the defect these guard is
// epub.js painting the highlight SVG at a stale layout's pixel rects, so the
// assertion has to compare the painted overlay against the rendered prose
// itself. Returns the worst axis drift between the SVG union box and the live
// range's union box; Infinity while unmeasurable. Shared by the font-size and
// typeface tests, which seed the same mid-paragraph range on their own books.
const overlayDrift = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const view = document.querySelector("#omnibus-viewer .epub-view");
    const iframe = view?.querySelector("iframe");
    const rects = view
      ? Array.from(view.querySelectorAll(":scope > svg rect"))
      : [];
    const doc = iframe?.contentDocument;
    // The seeded CFI targets the <p> after the <h1> — mirror it exactly.
    const text = doc?.body?.querySelector("p")?.firstChild;
    if (
      !iframe ||
      !doc ||
      rects.length === 0 ||
      !text ||
      text.nodeType !== Node.TEXT_NODE
    ) {
      return Number.POSITIVE_INFINITY;
    }
    const range = doc.createRange();
    const len = (text as Text).data.length;
    range.setStart(text, Math.min(10, len));
    range.setEnd(text, Math.min(24, len));
    const t = range.getBoundingClientRect();
    const ifr = iframe.getBoundingClientRect();
    const union = rects
      .map((r) => r.getBoundingClientRect())
      .reduce(
        (a, b) => ({
          left: Math.min(a.left, b.left),
          top: Math.min(a.top, b.top),
        }),
        { left: Number.POSITIVE_INFINITY, top: Number.POSITIVE_INFINITY },
      );
    return Math.max(
      Math.abs(union.left - (t.left + ifr.left)),
      Math.abs(union.top - (t.top + ifr.top)),
    );
  });

// The family the embedded-font fixture declares (tools/make_epub.ts).
const EMBEDDED_FAMILY = "Fixture Serif";

// The typeface contract lives inside the section iframe (same-origin, so
// contentDocument is reachable). `override` is the reader's own font layer:
// "" under Original — the absence of a declaration is the contract.
//
// Two of these fields exist because a rendered glyph proves nothing on its own:
// both Blink and WebKit fall through from an `@font-face` whose fetch was
// refused to the next declared copy, so the publisher's face still paints even
// when a `blob:` copy was requested and refused first.
//
//   `embeddedSrcs` is the structural assertion — every `src` declared for the
//   embedded family, across every sheet the section holds (the blob-linked one
//   included; it is same-origin and readable). A `blob:` among them means a
//   copy exists that CSP will refuse, whatever renders.
//   `faces` carries every face's *status*, so a refused copy shows as `error`.
const sectionFontState = (page: Page) =>
  page.evaluate((family: string) => {
    const iframe = document.querySelector(
      "#omnibus-viewer iframe",
    ) as HTMLIFrameElement | null;
    const doc = iframe?.contentDocument;
    const p = doc?.body?.querySelector("p");
    if (!doc || !p) return null;

    const embeddedSrcs: string[] = [];
    for (const sheet of Array.from(doc.styleSheets)) {
      let rules: CSSRuleList | undefined;
      try {
        rules = sheet.cssRules;
      } catch {
        continue; // a sheet this document may not read
      }
      for (const rule of Array.from(rules ?? [])) {
        // Numeric type, not `instanceof CSSFontFaceRule`: the constructor in
        // this realm is not the one the iframe's rules were built with.
        if (rule.type !== CSSRule.FONT_FACE_RULE) continue;
        const style = (rule as CSSFontFaceRule).style;
        const declared = style
          .getPropertyValue("font-family")
          .replace(/["']/g, "")
          .trim();
        if (declared !== family) continue;
        embeddedSrcs.push(style.getPropertyValue("src"));
      }
    }

    return {
      override: doc.getElementById("__omnibus_font")?.textContent ?? null,
      bodyInline: doc.body.style.fontFamily,
      paragraphFamily: getComputedStyle(p).fontFamily,
      embeddedSrcs,
      // The reader's own sheet, as the section actually received it.
      fontsHref:
        doc.getElementById("__omnibus_fonts")?.getAttribute("href") ?? null,
      faces: Array.from(doc.fonts).map((f) => ({
        family: f.family.replace(/["']/g, ""),
        status: f.status,
      })),
    };
  }, EMBEDDED_FAMILY);

// A CSP refusal to load a font, as the browser reports it on the console. The
// blob-stylesheet spec's collector matches `style-src|stylesheet` only, so a
// `font-src` refusal — the symptom of a wrongly ordered @font-face cascade —
// is invisible to it.
function collectFontCspViolations(page: Page): string[] {
  const violations: string[] = [];
  page.on("console", (msg) => {
    const text = msg.text();
    if (
      /content security policy/i.test(text) &&
      /font-src|load the font/i.test(text)
    ) {
      violations.push(text);
    }
  });
  return violations;
}

test.describe("epub reader", () => {
  test.beforeAll("seed the library", async ({ request }) => {
    await seedLibrary(request, fixturesDir(), FIXTURE_BOOKS.length);
  });

  test("show the reader layout", async ({ epubReaderPage, request }) => {
    const uuid = await fetchBookUuidByTitle(request, TARGET.title);

    await test.step("open the book", async () => {
      await epubReaderPage.goto(uuid);
    });

    // Only the chrome: epub.js may not paint headlessly, the chrome is SSR.
    await test.step("check the chrome shows", async () => {
      await epubReaderPage.assertDisplayed();
      // #2249: the counter never opens on a `Ch 0` that cannot reach its total.
      await expect(epubReaderPage.chapterCounterLabel).toHaveText(
        /^Ch [1-9]\d* of \d+$/,
      );
      await expect(epubReaderPage.backButton).toBeVisible();
      await expect(epubReaderPage.contentsButton).toBeVisible();
      await expect(epubReaderPage.searchButton).toBeVisible();
      await expect(epubReaderPage.displayPanelButton).toBeVisible();
      await expect(epubReaderPage.highlightsButton).toBeVisible();
      await expect(epubReaderPage.bookmarkButton).toBeVisible();
      await expect(epubReaderPage.previousPageButton).toBeVisible();
      await expect(epubReaderPage.nextPageButton).toBeVisible();
    });
  });

  test("leave the reader for the book detail page with the back button", async ({
    epubReaderPage,
    bookDetailPage,
    request,
  }) => {
    const uuid = await fetchBookUuidByTitle(request, TARGET.title);

    await test.step("open the book", async () => {
      await epubReaderPage.goto(uuid);
      await expect(epubReaderPage.backButton).toBeVisible();
    });

    // Back always lands on the book's page, whichever entry opened the reader.
    await test.step("go back", async () => {
      await epubReaderPage.goBack();
    });

    await test.step("check the book detail page shows", async () => {
      await bookDetailPage.assertDisplayedFor(uuid);
    });
  });

  test.describe("display panel", () => {
    test("open the display panel with the original typeface selected", async ({
      epubReaderPage,
      request,
    }) => {
      const panel = epubReaderPage.displayPanel;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("open the book", async () => {
        await epubReaderPage.goto(uuid);
      });

      await test.step("open the display panel", async () => {
        await epubReaderPage.openDisplayPanel();
        await expect(panel.decreaseFontButton).toBeVisible();
        await expect(panel.increaseFontButton).toBeVisible();
        await expect(panel.pageViewButton("single")).toBeVisible();
        await expect(panel.pageViewButton("double")).toBeVisible();
      });

      // Original keeps the publisher's faces, which a new reader gets.
      await test.step("check every typeface shows, Original selected", async () => {
        for (const face of TYPEFACES) {
          await expect(panel.typefaceButton(face)).toBeVisible();
        }
        await expect(panel.typefaceButton("original")).toHaveClass(/\bon\b/);
      });
    });

    // #2252: the scrim covered the Aa button, so it could not close its panel.
    test("close the display panel with its button", async ({
      epubReaderPage,
      request,
    }) => {
      const panel = epubReaderPage.displayPanel;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("open the display panel", async () => {
        await epubReaderPage.goto(uuid);
        await epubReaderPage.openDisplayPanel();
        await expect(panel.root).toBeVisible();
      });

      await test.step("close it with the same button", async () => {
        await epubReaderPage.closeDisplayPanel();
        await expect(panel.root).toHaveCount(0);
      });
    });

    // #2252: lifting the top bar over the scrim must not cost this dismissal.
    test("close the display panel with escape", async ({
      epubReaderPage,
      request,
    }) => {
      const panel = epubReaderPage.displayPanel;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("open the display panel", async () => {
        await epubReaderPage.goto(uuid);
        await epubReaderPage.openDisplayPanel();
        await expect(panel.root).toBeVisible();
      });

      await test.step("close it with escape", async () => {
        await epubReaderPage.closeWithEscape();
        await expect(panel.root).toHaveCount(0);
      });
    });

    // #2252: lifting the top bar over the scrim must not cost this dismissal.
    test("close the display panel by clicking outside it", async ({
      epubReaderPage,
      request,
    }) => {
      const panel = epubReaderPage.displayPanel;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("open the display panel", async () => {
        await epubReaderPage.goto(uuid);
        await epubReaderPage.openDisplayPanel();
        await expect(panel.root).toBeVisible();
      });

      await test.step("click the scrim", async () => {
        await panel.closeByClickingOutside();
        await expect(panel.root).toHaveCount(0);
      });
    });
  });

  test.describe("drawers", () => {
    test("open the search drawer from the top chrome", async ({
      epubReaderPage,
      request,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("open the search drawer", async () => {
        await epubReaderPage.goto(uuid);
        await epubReaderPage.openSearch();
      });

      await test.step("check the drawer offers a query field", async () => {
        await expect(epubReaderPage.searchDrawer).toBeVisible();
        await expect(epubReaderPage.searchField).toBeVisible();
      });

      await test.step("close it with escape", async () => {
        await epubReaderPage.closeWithEscape();
        await expect(epubReaderPage.searchDrawer).toHaveCount(0);
      });
    });

    test("open the bookmarks drawer from the top chrome", async ({
      epubReaderPage,
      request,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("open the bookmarks drawer", async () => {
        await epubReaderPage.goto(uuid);
        await epubReaderPage.openBookmarks();
      });

      await test.step("check the drawer offers to add a bookmark", async () => {
        await expect(epubReaderPage.bookmarksDrawer).toBeVisible();
        await expect(epubReaderPage.addBookmarkButton).toBeVisible();
      });
    });

    test("open the highlights drawer on its empty state", async ({
      epubReaderPage,
      request,
    }) => {
      const drawer = epubReaderPage.highlightsDrawer;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("open the highlights drawer", async () => {
        await epubReaderPage.goto(uuid);
        await epubReaderPage.openHighlights();
      });

      await test.step("check the drawer is empty", async () => {
        await expect(drawer.root).toBeVisible();
        await expect(drawer.emptyMessage).toBeVisible();
      });

      // The drawer's scrim otherwise covers the chrome.
      await test.step("close it with escape", async () => {
        await epubReaderPage.closeWithEscape();
        await expect(drawer.root).toHaveCount(0);
      });
    });

    test("open the contents drawer from the top chrome", async ({
      epubReaderPage,
      request,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("open the contents drawer", async () => {
        await epubReaderPage.goto(uuid);
        await epubReaderPage.openContents();
      });

      await test.step("check the drawer shows", async () => {
        await expect(epubReaderPage.contentsDrawer.root).toBeVisible();
      });
    });
  });

  test.describe("contents", () => {
    test("name the chapter the page is in when several share its spine document", async ({
      epubReaderPage,
      request,
    }) => {
      const contents = epubReaderPage.contentsDrawer;
      const uuid = await fetchBookUuidByTitle(request, SHARED_SPINE_BOOK.title);

      await test.step("open the book inside the first chapter", async () => {
        await epubReaderPage.gotoPassage(uuid, SHARED_SPINE_CFI);
      });

      await test.step("check the header names the chapter", async () => {
        await expect(epubReaderPage.headerChapterLabel).toHaveText(
          "CHAPTER 1. Loomings.",
          { timeout: 20_000 },
        );
      });

      await test.step("check the contents drawer marks the same entry", async () => {
        await epubReaderPage.openContents();
        await expect(contents.root).toBeVisible();
        await expect(contents.currentEntryButton).toHaveText(
          "CHAPTER 1. Loomings.",
        );
      });
    });

    // #1909: a jump shows loading, never the outgoing chapter beside new text.
    test("show a loading state in place of the outgoing chapter during a contents jump", async ({
      epubReaderPage,
      request,
      expectMutation,
    }) => {
      test.setTimeout(90_000);
      const contents = epubReaderPage.contentsDrawer;
      const uuid = await fetchBookUuidByTitle(request, TOC_JUMP_BOOK.title);

      // The book opens on its cover, which has no entry and no header chapter.
      // A first jump gives the header something to clear.
      await test.step("jump to a first chapter", async () => {
        await epubReaderPage.goto(uuid);
        await epubReaderPage.openContents();
        await expect(contents.root).toBeVisible();
        await expect(contents.entryButton(CHAPTER_ONE)).toBeVisible();
        await expectMutation(progress.saveAfterJump(), () =>
          contents.jumpTo(CHAPTER_ONE),
        );
        await expect(contents.root).toHaveCount(0);
        await expect(epubReaderPage.headerChapterLabel).toBeVisible({
          timeout: 20_000,
        });
      });

      // The jump lands with the relocate that saves progress, so that save is
      // the strongest sign it landed.
      await test.step("jump further into the book", async () => {
        await epubReaderPage.openContents();
        await expect(contents.root).toBeVisible();
        await expect(contents.entryButton(CHAPTER_FOUR)).toBeVisible();
        await expectMutation(progress.saveAfterJump(), async () => {
          await contents.jumpTo(CHAPTER_FOUR);
          // The click closes the drawer and shows loading at once, so no race.
          await expect(contents.root).toHaveCount(0);
          await expect(epubReaderPage.loadingOverlay).toBeVisible();
          await expect(epubReaderPage.headerChapterLabel).toHaveCount(0);
        });
      });

      await test.step("check the jump lands", async () => {
        await expect(epubReaderPage.loadingOverlay).toHaveCount(0);
        await expect(epubReaderPage.headerChapterLabel).toBeVisible({
          timeout: 20_000,
        });
      });
    });

    // #2450: a jump that cannot resolve clears loading and says so.
    test("report a contents jump that cannot land", async ({
      epubReaderPage,
      request,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, TOC_JUMP_BOOK.title);

      await test.step("open the book", async () => {
        await epubReaderPage.goto(uuid);
        await expect(epubReaderPage.loadingOverlay).toHaveCount(0, {
          timeout: 20_000,
        });
      });

      // An entry whose href matches no spine item, the #2450 shape.
      await test.step("jump to an entry that matches no section", async () => {
        await epubReaderPage.stubContents([
          { label: "Nowhere", href: "missing.xhtml", level: 0 },
        ]);
        await epubReaderPage.openContents();
        await epubReaderPage.contentsDrawer.jumpTo("Nowhere");
      });

      await test.step("check the reader says so", async () => {
        await expect(epubReaderPage.navErrorMessage).toBeVisible();
        await expect(epubReaderPage.loadingOverlay).toHaveCount(0);
      });
    });

    // #2450: the failed-jump notice takes no pointer events.
    test("let clicks pass through the failed-jump notice", async ({
      epubReaderPage,
      request,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, TOC_JUMP_BOOK.title);

      await test.step("open the book", async () => {
        await epubReaderPage.goto(uuid);
        await expect(epubReaderPage.loadingOverlay).toHaveCount(0, {
          timeout: 20_000,
        });
      });

      await test.step("jump to an entry that matches no section", async () => {
        await epubReaderPage.stubContents([
          { label: "Nowhere", href: "missing.xhtml", level: 0 },
        ]);
        await epubReaderPage.openContents();
        await epubReaderPage.contentsDrawer.jumpTo("Nowhere");
        await expect(epubReaderPage.navErrorMessage).toBeVisible();
      });

      await test.step("check a click at the notice lands beneath it", async () => {
        expect(await epubReaderPage.navErrorInterceptsPointer()).toBe(false);
      });
    });

    // #2450: an entry relative to a subfolder nav doc resolves on the spine.
    test("resolve a contents jump relative to a nav doc in a subfolder", async ({
      epubReaderPage,
      request,
      expectMutation,
    }) => {
      const contents = epubReaderPage.contentsDrawer;
      const uuid = await fetchBookUuidByTitle(request, TOC_JUMP_BOOK.title);

      // The stand-in leaves the real file and its saved position untouched.
      await test.step("open the stand-in book", async () => {
        await epubReaderPage.stubBookFile(uuid, await buildSubfolderNavEpub());
        await epubReaderPage.goto(uuid);
        await expect(epubReaderPage.loadingOverlay).toHaveCount(0, {
          timeout: 20_000,
        });
      });

      await test.step("jump to its third chapter", async () => {
        await epubReaderPage.openContents();
        await expect(contents.root).toBeVisible();
        await expectMutation(progress.saveAfterJump(), () =>
          contents.jumpTo("Chapter Three"),
        );
        await expect(contents.root).toHaveCount(0);
      });

      await test.step("check the jump landed", async () => {
        await expect(epubReaderPage.loadingOverlay).toHaveCount(0, {
          timeout: 20_000,
        });
        await expect(epubReaderPage.navErrorMessage).toHaveCount(0);
        await expect(epubReaderPage.headerChapterLabel).toHaveText(
          "Chapter Three",
          { timeout: 20_000 },
        );
      });
    });
  });

  test.describe("highlights", () => {
    test("delete a highlight from the highlights drawer", async ({
      epubReaderPage,
      request,
      highlightOn,
      seededHighlightIds,
      expectMutation,
    }) => {
      const drawer = epubReaderPage.highlightsDrawer;
      const uuid = await fetchBookUuidByTitle(request, HL_BOOK.title);
      const highlight = await highlightOn(uuid);
      const row = drawer.row(highlight.text);

      await test.step("open the highlights drawer", async () => {
        await epubReaderPage.goto(uuid);
        await epubReaderPage.openHighlights();
        await expect(drawer.root).toBeVisible();
        await expect(row.root).toHaveCount(1);
      });

      await test.step("delete the highlight", async () => {
        await expectMutation(highlights.delete(), () => row.delete());
        seededHighlightIds.delete(highlight.id);
      });

      await test.step("check the quote is gone", async () => {
        await expect(drawer.quoteText(highlight.text)).toHaveCount(0);
      });
    });

    test("add a note to a highlight from the drawer", async ({
      epubReaderPage,
      request,
      highlightOn,
      expectMutation,
    }) => {
      const drawer = epubReaderPage.highlightsDrawer;
      const note = "a thought worth keeping";
      const uuid = await fetchBookUuidByTitle(request, NOTE_BOOK.title);
      const highlight = await highlightOn(uuid);
      const row = drawer.row(highlight.text);

      await test.step("open the highlights drawer", async () => {
        await epubReaderPage.goto(uuid);
        await epubReaderPage.openHighlights();
        await expect(drawer.root).toBeVisible();
        await expect(row.root).toHaveCount(1);
        await expect(row.noteButton).toHaveText("Add note");
      });

      await test.step("write a note in the composer", async () => {
        await row.openNoteComposer();
        await expect(drawer.noteComposerPanel).toBeVisible();
        await drawer.enterNote(note);
      });

      await test.step("save the note", async () => {
        await expectMutation(highlights.updateNote(), () => drawer.saveNote());
        await expect(drawer.noteComposerPanel).toHaveCount(0);
      });

      await test.step("check the row shows the saved note", async () => {
        await epubReaderPage.openHighlights();
        await expect(row.noteText(note)).toBeVisible();
        await expect(row.noteButton).toHaveText("Edit note");
      });
    });

    test("recolor a highlight from the drawer", async ({
      epubReaderPage,
      request,
      highlightOn,
      expectMutation,
    }) => {
      const drawer = epubReaderPage.highlightsDrawer;
      const uuid = await fetchBookUuidByTitle(request, RECOLOR_BOOK.title);
      const highlight = await highlightOn(uuid);
      const row = drawer.row(highlight.text);

      await test.step("open the highlights drawer", async () => {
        await epubReaderPage.goto(uuid);
        await epubReaderPage.openHighlights();
        await expect(drawer.root).toBeVisible();
        await expect(row.root).toHaveCount(1);
      });

      await test.step("check amber is the selected color", async () => {
        await expect(row.recolorButton("amber")).toHaveAttribute(
          "aria-pressed",
          "true",
        );
        await expect(row.recolorButton("green")).toHaveAttribute(
          "aria-pressed",
          "false",
        );
      });

      await test.step("pick green", async () => {
        await expectMutation(highlights.updateColor(), () =>
          row.recolor("green"),
        );
      });

      await test.step("check green is the selected color", async () => {
        await expect(row.recolorButton("green")).toHaveAttribute(
          "aria-pressed",
          "true",
        );
        await expect(row.recolorButton("amber")).toHaveAttribute(
          "aria-pressed",
          "false",
        );
      });
    });
  });

  // The phone shell renders this reader in a WebView, so check its layout here.
  test.describe("phone viewport", () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test("show the mobile reader layout", async ({
      epubReaderPage,
      request,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("open the book", async () => {
        await epubReaderPage.goto(uuid);
      });

      await test.step("check the viewer and top tools show", async () => {
        await epubReaderPage.assertDisplayed();
        await expect(epubReaderPage.backButton).toBeVisible();
        await expect(epubReaderPage.contentsButton).toBeVisible();
      });

      // Phones turn pages by swipe or tap, so the buttons would cover prose.
      await test.step("check the page-turn buttons are hidden", async () => {
        await expect(epubReaderPage.previousPageButton).toBeHidden();
        await expect(epubReaderPage.nextPageButton).toBeHidden();
      });

      // One Annotations tool replaces the separate highlights and bookmark tools.
      await test.step("check the annotations tool replaces highlights and bookmark", async () => {
        await expect(epubReaderPage.annotationsButton).toBeVisible();
        await expect(epubReaderPage.highlightsButton).toBeHidden();
        await expect(epubReaderPage.bookmarkButton).toBeHidden();
      });
    });

    test("open the combined annotations sheet with its kind filters", async ({
      epubReaderPage,
      request,
    }) => {
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("open the annotations sheet", async () => {
        await epubReaderPage.goto(uuid);
        await epubReaderPage.openAnnotations();
      });

      await test.step("check the sheet offers a bookmarks filter and an add", async () => {
        await expect(epubReaderPage.annotationsSheet).toBeVisible();
        await expect(epubReaderPage.bookmarksFilterButton).toBeVisible();
        await expect(epubReaderPage.addAnnotationButton).toBeVisible();
      });

      await test.step("filter the sheet to bookmarks", async () => {
        await epubReaderPage.filterAnnotationsToBookmarks();
        await expect(epubReaderPage.annotationsSheet).toBeVisible();
      });

      await test.step("close it with escape", async () => {
        await epubReaderPage.closeWithEscape();
        await expect(epubReaderPage.annotationsSheet).toHaveCount(0);
      });
    });

    test("stretch the contents drawer across a phone screen", async ({
      epubReaderPage,
      request,
    }) => {
      const drawer = epubReaderPage.contentsDrawer;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("open the contents drawer", async () => {
        await epubReaderPage.goto(uuid);
        await epubReaderPage.openContents();
        await expect(drawer.root).toBeVisible();
      });

      // On a desktop the drawer is a 380px side panel.
      await test.step("check the drawer spans the screen", async () => {
        const width = await epubReaderPage.renderedWidth(drawer.root);
        expect(width).toBeGreaterThan(370);
      });

      await test.step("close it with escape", async () => {
        await epubReaderPage.closeWithEscape();
        await expect(drawer.root).toHaveCount(0);
      });
    });

    test("pin the display panel under the top bar on a phone", async ({
      epubReaderPage,
      request,
    }) => {
      const panel = epubReaderPage.displayPanel;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("open the display panel", async () => {
        await epubReaderPage.goto(uuid);
        await epubReaderPage.openDisplayPanel();
        await expect(panel.increaseFontButton).toBeVisible();
      });

      // On a desktop the panel is a 320px popover beside its tool.
      await test.step("check the panel spans the screen", async () => {
        const width = await epubReaderPage.renderedWidth(panel.root);
        expect(width).toBeGreaterThan(340);
      });
    });
  });
});

/**
 * Whether the prose on screen stays clear of both page-turn buttons, as a
 * sentence a failed poll can print. A page without a spread of prose on it
 * proves nothing, so it is not clear either.
 */
async function turnButtonClearance(page: Page): Promise<string> {
  const m = await page.evaluate(() => {
    const clip = document
      .querySelector("#omnibus-viewer")
      ?.getBoundingClientRect();
    const prev = document
      .querySelector("[data-testid=reader-prev]")
      ?.getBoundingClientRect();
    const next = document
      .querySelector("[data-testid=reader-next]")
      ?.getBoundingClientRect();
    const frame = document.querySelector<HTMLIFrameElement>(
      "#omnibus-viewer iframe",
    );
    const doc = frame?.contentDocument;
    if (!clip || !prev || !next || !frame || !doc?.body) return null;
    const off = frame.getBoundingClientRect();
    let left = Number.POSITIVE_INFINITY;
    let right = Number.NEGATIVE_INFINITY;
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!(n as Text).data.trim()) continue;
      const range = doc.createRange();
      range.selectNodeContents(n);
      for (const box of Array.from(range.getClientRects())) {
        const l = off.left + box.left;
        const r = off.left + box.right;
        // The rest of the section sits beside the page, clipped by the viewer.
        if (box.width === 0 || r <= clip.left || l >= clip.right) continue;
        left = Math.min(left, l);
        right = Math.max(right, r);
      }
    }
    return {
      underPrev: prev.right - left,
      underNext: right - next.left,
      span: (right - left) / clip.width,
    };
  });
  if (!m || !(m.span > 0.6)) return "no page of prose on screen";
  if (m.underPrev > 0) {
    return `prose runs ${Math.ceil(m.underPrev)}px under the previous-page button`;
  }
  if (m.underNext > 0) {
    return `prose runs ${Math.ceil(m.underNext)}px under the next-page button`;
  }
  return "clear";
}

test("keeps the page-turn buttons clear of the prose in one- and two-page view", async ({
  page,
  request,
}) => {
  const uuid = await fetchBookUuidByTitle(request, GUTTER_BOOK.title);
  const passage = `/read/${uuid}?cfi=${encodeURIComponent(GUTTER_CFI)}`;
  await page.setViewportSize({ width: 1920, height: 900 });
  await gotoReady(page, passage);
  await expect(page.getByTestId("reader-viewer")).toBeVisible();

  for (const spread of ["single", "double"] as const) {
    await page.getByTestId("reader-aa").click();
    await page.getByTestId(`reader-spread-${spread}`).click();
    await page.keyboard.press("Escape");
    // Reopened at the passage for each width rather than resized into it: a
    // resize re-displays wherever the last layout left the reader, so the
    // spread measured would depend on every width before it.
    for (const width of [1920, 1280, 800]) {
      await page.setViewportSize({ width, height: 900 });
      await gotoReady(page, passage);
      await expect
        .poll(() => turnButtonClearance(page), {
          message: `${spread} view at ${width}px`,
          timeout: 20_000,
        })
        .toBe("clear");
    }
  }
});

test("black theme overrides a publisher color on the EPUB body", async ({
  page,
  request,
}) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("omn.theme", "black");
  });
  const uuid = await fetchBookUuidByTitle(request, TARGET.title);
  await gotoReady(page, `/read/${uuid}`);

  // Intentional exception: this regression must inspect rendered EPUB prose
  // to verify a publisher body colour cannot override the reader theme.
  const prose = page
    .frameLocator("#omnibus-viewer iframe")
    .getByText("Synthetic test content.");
  await expect(prose).toBeVisible();
  await expect
    .poll(() => prose.evaluate((el) => getComputedStyle(el).color))
    .toBe("rgb(255, 255, 255)");
});

test("keeps a seeded highlight glued to its text across font-size changes", async ({
  page,
  request,
}) => {
  const uuid = await fetchBookUuidByTitle(request, OVERLAY_BOOK.title);

  // Seed a mid-paragraph range — chars 10–24 of the `<p>` (`/4/4`, after the
  // `<h1>` at `/4/2`) in the single-item spine (`/6/2`). Its painted position
  // genuinely moves when the font grows, so a stale overlay can't pass by
  // accident the way a range anchored at the paragraph origin would. (The
  // drawer specs above seed `/6/4!/4/2` anchors, but those are never
  // resolved against the DOM — this one is, so it must be exact.)
  const quote = `overlay passage ${Date.now()}`;
  const created = await request.post("/api/highlights", {
    data: {
      book_uuid: uuid,
      epub_cfi_range: "epubcfi(/6/2!/4/4,/1:10,/1:24)",
      color: "amber",
      text: quote,
    },
  });
  expect(created.status(), "seed highlight").toBe(200);

  await gotoReady(page, `/read/${uuid}`);
  await expect(page.getByTestId("reader-viewer")).toBeVisible();

  // Painted over the prose on first open, with no font-size nudge — the add
  // used to be dropped entirely when it raced the epub.js bootstrap.
  await expect
    .poll(() => overlayDrift(page), { timeout: 20_000 })
    .toBeLessThan(3);

  // Grow the text twice (18 → 20px). Each step reflows the prose without
  // changing the section's one-spread width — exactly the case where
  // epub.js skips the reframe that would have repositioned the marks.
  await page.getByTestId("reader-aa").click();
  await expect(page.getByTestId("reader-font-increase")).toBeVisible();
  await page.getByTestId("reader-font-increase").click();
  await page.getByTestId("reader-font-increase").click();

  await expect
    .poll(() => overlayDrift(page), { timeout: 10_000 })
    .toBeLessThan(3);
});

// The default is Original: no reader override at all, so a book's own faces
// render exactly as the publisher set them (Apple Books parity). The embedded
// face arrives because the glue re-points epub.js's resource table at `data:`
// URIs *before the first section is serialized* — a section's fonts are
// requested during its first layout, well before any content hook could run, so
// nothing added afterwards can stop a `blob:` request the CSP then refuses.
test("opens a book in its own embedded font with no reader override (Original)", async ({
  page,
  request,
}) => {
  const fontCspViolations = collectFontCspViolations(page);

  const uuid = await fetchBookUuidByTitle(request, FONT_BOOK.title);
  await gotoReady(page, `/read/${uuid}`);
  await expect(page.getByTestId("reader-viewer")).toBeVisible();

  await expect
    .poll(async () => await sectionFontState(page), { timeout: 20_000 })
    .toMatchObject({
      faces: expect.arrayContaining([
        { family: EMBEDDED_FAMILY, status: "loaded" },
      ]),
    });

  const state = await sectionFontState(page);
  // Present but EMPTY: any declaration on `body *`, `inherit` included, would
  // flatten the publisher's faces.
  expect(state?.override).toBe("");
  // epub.js's own `themes.font` wrote the stack inline on <body>; nothing may
  // put it back.
  expect(state?.bodyInline).toBe("");
  expect(state?.paragraphFamily).toMatch(/^"?Fixture Serif"?/);

  // The structural guard. A rendered "Fixture Serif" proves nothing by itself —
  // the browser falls through from a refused @font-face to the next declared
  // copy, so the page looks identical whether or not a blob: copy was requested
  // and refused. These three assert on what is *declared* and what the faces
  // did, not on what happened to paint:
  //   - the archive's bytes reached the section as a data: URI;
  //   - no blob: copy exists at all, so there is nothing for CSP to refuse;
  //   - and nothing errored.
  expect(
    state?.embeddedSrcs.some((s) => s.includes("data:font/woff2;base64,")),
    `the embedded face must be declared as data:\n${state?.embeddedSrcs.join("\n")}`,
  ).toBe(true);
  expect(
    state?.embeddedSrcs.filter((s) => s.includes("blob:")),
    "no blob: copy of the embedded face may be declared — font-src would refuse it",
  ).toEqual([]);
  expect(
    state?.faces.filter(
      (f) => f.family === EMBEDDED_FAMILY && f.status === "error",
    ),
    "an errored face means a copy was requested and refused",
  ).toEqual([]);
  // Asserted last: the awaits above outlast the browser's console delivery.
  expect(
    fontCspViolations,
    `no font may be refused by font-src:\n${fontCspViolations.join("\n")}`,
  ).toEqual([]);
});

test("a named typeface is self-hosted and overrides the publisher's element-level font", async ({
  page,
  request,
}) => {
  // Every reader face must come from this origin. The app chrome still
  // `@import`s Cormorant Garamond / Instrument Sans / Space Mono from Google,
  // so the guard is per-family rather than per-host: no Google request may
  // name either *reading* family.
  const fontRequests: string[] = [];
  page.on("request", (r) => {
    const url = r.url();
    if (/reader-fonts|fonts\.g(static|oogleapis)/.test(url)) {
      fontRequests.push(url);
    }
  });
  const fontCspViolations = collectFontCspViolations(page);

  const uuid = await fetchBookUuidByTitle(request, FONT_BOOK.title);
  await gotoReady(page, `/read/${uuid}`);
  await expect(page.getByTestId("reader-viewer")).toBeVisible();

  await page.getByTestId("reader-aa").click();
  await page.getByTestId("reader-typeface-editorial").click();

  // One snapshot: the typeface change re-mounts the reader, so a second read
  // can land on the section it is tearing down.
  await expect
    .poll(async () => await sectionFontState(page), { timeout: 20_000 })
    .toMatchObject({
      paragraphFamily: expect.stringMatching(/^"?Instrument Serif"?/),
      faces: expect.arrayContaining([
        { family: "Instrument Serif", status: "loaded" },
      ]),
      // `body,body *` is what beats the publisher's element-level `p` rule.
      override: expect.stringContaining(
        "body,body *{font-family:'Instrument Serif'",
      ),
      // The section itself got the sheet — the request log alone would also
      // be satisfied by the parent document's AA-panel chip preview, which
      // loads the same file and proves nothing about the iframe.
      fontsHref: expect.stringMatching(
        /\/assets\/reader-fonts\/reader-fonts\.css$/,
      ),
    });

  expect(
    fontRequests.some((u) =>
      u.includes("/assets/reader-fonts/InstrumentSerif-Regular.woff2"),
    ),
    `reader face must be served from this origin:\n${fontRequests.join("\n")}`,
  ).toBe(true);
  expect(
    fontRequests.filter((u) =>
      /fonts\.g(static|oogleapis)\.com.*(instrument.?serif|eb.?garamond)/i.test(
        u,
      ),
    ),
    "no reading face may come from Google",
  ).toEqual([]);

  // The boot path (and `omn.typeface`) must land on the same face the runtime
  // call did — a reload is the only thing that exercises it.
  await page.reload();
  await expect(page.getByTestId("reader-viewer")).toBeVisible();
  await expect
    .poll(async () => await sectionFontState(page), { timeout: 20_000 })
    .toMatchObject({
      paragraphFamily: expect.stringMatching(/^"?Instrument Serif"?/),
    });
  await page.getByTestId("reader-aa").click();
  await expect(page.getByTestId("reader-typeface-editorial")).toHaveClass(
    /\bon\b/,
  );

  // Back to Original at runtime: the override is removed outright, and the
  // publisher's embedded face takes the page back.
  await page.getByTestId("reader-typeface-original").click();
  await expect
    .poll(async () => await sectionFontState(page), { timeout: 20_000 })
    .toMatchObject({
      override: "",
      paragraphFamily: expect.stringMatching(/^"?Fixture Serif"?/),
      faces: expect.arrayContaining([
        { family: EMBEDDED_FAMILY, status: "loaded" },
      ]),
    });

  // Neither the reader's own faces nor the book's were refused, across both
  // page loads and both directions of the switch.
  expect(
    fontCspViolations,
    `no font may be refused by font-src:\n${fontCspViolations.join("\n")}`,
  ).toEqual([]);
});

test("keeps a seeded highlight glued to its text across typeface changes", async ({
  page,
  request,
}) => {
  const uuid = await fetchBookUuidByTitle(request, FONT_BOOK.title);

  // Same mid-paragraph range as the font-size test: chars 10–24 of the `<p>`
  // (`/4/4`, after the `<h1>` at `/4/2`) in the single-item spine (`/6/2`).
  const quote = `typeface passage ${Date.now()}`;
  const created = await request.post("/api/highlights", {
    data: {
      book_uuid: uuid,
      epub_cfi_range: "epubcfi(/6/2!/4/4,/1:10,/1:24)",
      color: "amber",
      text: quote,
    },
  });
  expect(created.status(), "seed highlight").toBe(200);

  await gotoReady(page, `/read/${uuid}`);
  await expect(page.getByTestId("reader-viewer")).toBeVisible();
  await expect
    .poll(() => overlayDrift(page), { timeout: 20_000 })
    .toBeLessThan(3);

  // A real reflow: monospace metrics are nothing like the embedded serif's.
  await page.getByTestId("reader-aa").click();
  await page.getByTestId("reader-typeface-mono").click();
  await expect
    .poll(() => overlayDrift(page), { timeout: 20_000 })
    .toBeLessThan(3);

  // And back — the embedded face has to reload and reflow under the marks.
  await page.getByTestId("reader-typeface-original").click();
  await expect
    .poll(() => overlayDrift(page), { timeout: 20_000 })
    .toBeLessThan(3);
});

// Holding JSZip back is the #2449 regression: a client-side navigation ran
// the reader scripts in download order, and an epub.js that ran before JSZip
// failed every open until a reload.
test("opens the reader from the book detail Read action", async ({
  page,
  request,
}) => {
  const uuid = await fetchBookUuidByTitle(request, TARGET.title);
  await page.route(/\/jszip[^/]*\.js$/, async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.continue();
  });
  await gotoReady(page, `/books/${uuid}`);

  // The EPUB "Read" CTA in the format switcher routes into the immersive
  // reader. This is a read-only client-side navigation (no mutation), so we
  // follow the SPA route change and assert on the destination chrome.
  await page.getByTestId("action-read").click();
  await expect(page).toHaveURL(new RegExp(`/read/${uuid}$`));
  await expect(page.getByTestId("reader-viewer")).toBeVisible();
  await expect(page.locator("#omnibus-viewer iframe")).toBeAttached({
    timeout: 20_000,
  });
  await expect(page.getByTestId("reader-loading")).toHaveCount(0);
  await expect(page.getByTestId("reader-error")).toHaveCount(0);
});

test("Retry reloads a reader script that failed and opens the book", async ({
  page,
  request,
}) => {
  const uuid = await fetchBookUuidByTitle(request, TARGET.title);
  let aborted = false;
  await page.route(/\/epub\.min[^/]*\.js$/, async (route) => {
    if (aborted) return route.continue();
    aborted = true;
    await route.abort();
  });
  await gotoReady(page, `/read/${uuid}`);

  await expect(page.getByTestId("reader-error")).toBeVisible();
  await page.getByTestId("reader-retry").click();
  await expect(page.locator("#omnibus-viewer iframe")).toBeAttached({
    timeout: 20_000,
  });
  await expect(page.getByTestId("reader-loading")).toHaveCount(0);
  await expect(page.getByTestId("reader-error")).toHaveCount(0);
});

test("restores the exact reading position when the reader is reopened", async ({
  page,
  request,
}) => {
  const uuid = await fetchBookUuidByTitle(request, PROGRESS_BOOK.title);

  await gotoReady(page, `/read/${uuid}`);
  await expect(page.getByTestId("reader-viewer")).toBeVisible();

  // Page turns only produce label changes once whole-book pagination has
  // resolved (the first open generates it; later opens hit the locations
  // cache in localStorage).
  await expect
    .poll(async () => footerPageLabel(page), { timeout: 20_000 })
    .toMatch(PAGE_LABEL);
  const start = await footerPageLabel(page);

  // Turn eight spreads — far enough past the front matter to be in prose —
  // then keep turning (bounded) until the viewport start sits mid-paragraph:
  // a text-position CFI with a non-zero character offset (`…:469)`). Leaving
  // from the title/contents pages or an element boundary would under-test
  // the restore, since boundary CFIs restore at coarser granularity in
  // epub.js (a pre-existing display() limitation) while mid-text CFIs
  // restore exactly. The offset check is fixture- and version-agnostic, and
  // an environment that never yields one fails the guard below loudly
  // instead of silently under-testing. Each turn's save is awaited via
  // expectMutation so the 400 ms relocate debounce never coalesces two
  // turns into one save.
  const midTextCfi = /:[1-9]\d*\)$/;
  let leftCfi = "";
  for (let turn = 0; turn < 12; turn++) {
    const saved = await expectMutation(page, PROGRESS_POST, async () =>
      page.getByTestId("reader-next").click(),
    );
    leftCfi = saved.request.postDataJSON().update.epub_cfi as string;
    if (turn >= 7 && midTextCfi.test(leftCfi)) break;
  }
  expect(leftCfi, "should reach a mid-paragraph position").toMatch(midTextCfi);
  const leftAt = await footerPageLabel(page);
  expect(leftAt, "the turns should move the page label").not.toBe(start);

  // The stored position after a reopen must converge back on exactly where
  // we left: the restore may briefly persist a pre-correction snapshot, but
  // the settled landing (and the one-spread nudge for boundary CFIs) always
  // wins the last write.
  const storedCfi = async () =>
    (await storedProgress(request, uuid))?.epub_cfi ?? "";

  // Leave the reader (explicit navigation — equivalent to the reader-back
  // button, which routes to the book's detail page), then
  // reopen: it must land on the exact page we left, not a page drifted by
  // the first-pass display's pre-webfont layout. The restore settle is an
  // ECHO — it re-states a position the server already holds — so the
  // reopen must issue NO progress write at all: an echo write stamps a
  // fresh clock on an unmoved position, which shadows a newer audiobook
  // position at the cross-format clock gate.
  const progressPosts: string[] = [];
  page.on("request", (req) => {
    if (
      req.method() === "POST" &&
      /\/api\/rpc\/progress(?:\?|$)/.test(req.url())
    ) {
      progressPosts.push(req.postData() ?? "");
    }
  });
  await gotoReady(page, `/books/${uuid}`);
  await gotoReady(page, `/read/${uuid}`);
  await expect
    .poll(async () => footerPageLabel(page), { timeout: 20_000 })
    .toBe(leftAt);
  await expect.poll(storedCfi, { timeout: 10_000 }).toBe(leftCfi);
  // Asserted last in the phase: the slower polls above outlast the glue's
  // relocate debounce + async POST spawn, so a straggler echo write would
  // have landed in the collector by now.
  expect(progressPosts, "a reopen must not write progress").toEqual([]);

  // A real page turn after the restore still persists — the echo skip
  // must not mute genuine movement.
  const turned = await expectMutation(page, PROGRESS_POST, async () =>
    page.getByTestId("reader-next").click(),
  );
  const turnedCfi = turned.request.postDataJSON().update.epub_cfi as string;
  const turnedAt = await footerPageLabel(page);
  progressPosts.length = 0;

  // And again: the reopen lands on the turned page, still without writing.
  await gotoReady(page, `/books/${uuid}`);
  await gotoReady(page, `/read/${uuid}`);
  await expect
    .poll(async () => footerPageLabel(page), { timeout: 20_000 })
    .toBe(turnedAt);
  await expect.poll(storedCfi, { timeout: 10_000 }).toBe(turnedCfi);
  expect(progressPosts, "a reopen must not write progress").toEqual([]);
});

test("opens a percent-only position where it is and never writes over it", async ({
  page,
  request,
}) => {
  // The structure wait below can outlast the 60s default on a cold shard.
  test.setTimeout(180_000);
  const uuid = await fetchBookUuidByTitle(request, PERCENT_ONLY_BOOK.title);

  // What a Kobo sends: a whole-book percent and no CFI.
  const seeded = await request.post("/api/progress", {
    data: { book_uuid: uuid, format: "epub", progress_percent: 40 },
  });
  expect(seeded.status(), "seed a percent-only position").toBe(200);
  // The server places it once the book's structure is extracted — a worker
  // task queued behind the seed scan's word-count and page-count passes over
  // the whole public-domain set, so a cold server takes a while to get here.
  await expect
    .poll(async () => (await storedProgress(request, uuid))?.derived_epub_cfi, {
      timeout: 120_000,
      intervals: [2_000],
    })
    .toMatch(/^epubcfi\(/);

  const progressPosts: string[] = [];
  page.on("request", (req) => {
    if (
      req.method() === "POST" &&
      /\/api\/rpc\/progress(?:\?|$)/.test(req.url())
    ) {
      progressPosts.push(req.postData() ?? "");
    }
  });
  await gotoReady(page, `/read/${uuid}`);
  await expect(page.getByTestId("reader-viewer")).toBeVisible();

  // Lands at the stored place, read off the reader's own ruler once
  // whole-book pagination resolves (no "~") — not at the cover, which reads
  // 0%. The two rulers differ by a little, never by a tenth of the book.
  const settledPercent = async () => {
    const text = (await page.getByTestId("reader-footer").textContent()) ?? "";
    const m = text.match(/\u00b7\u00a0(\d+)%/);
    return m ? Number(m[1]) : -1;
  };
  await expect.poll(settledPercent, { timeout: 45_000 }).toBeGreaterThan(30);
  expect(await settledPercent()).toBeLessThan(46);

  // Asserted after the slow poll above, which outlasts the relocate
  // debounce: the open wrote nothing, so the Kobo's row stands as it was.
  expect(progressPosts, "opening must not write progress").toEqual([]);
  const stored = await storedProgress(request, uuid);
  expect(stored?.epub_cfi ?? null).toBeNull();
  expect(stored?.progress_percent).toBe(40);

  // Moving off the landing is the reader's own position, and it saves.
  const turned = await expectMutation(page, PROGRESS_POST, async () =>
    page.getByTestId("reader-next").click(),
  );
  expect(turned.request.postDataJSON().update.epub_cfi).toMatch(/^epubcfi\(/);
});

test("a ?cfi= deep link opens the reader at that passage, not the resume point", async ({
  page,
  request,
}) => {
  // Two sequential paginated opens (cold generate, then a cached reopen) plus
  // eight debounced page turns don't fit the 60s file default — the config
  // points such tests at their own budget.
  test.setTimeout(120_000);
  const uuid = await fetchBookUuidByTitle(request, DEEP_LINK_BOOK.title);

  // Read a way in and capture both the CFI and the page it renders on. The
  // CFI comes off the progress save, so it's exactly what a highlight taken
  // here would store.
  await gotoReady(page, `/read/${uuid}`);
  await expect(page.getByTestId("reader-viewer")).toBeVisible();
  // Cold-open headroom: this is the run that generates whole-book locations
  // (the sibling restore test's 20s assumes a book already paginated earlier
  // in the file; this book is opened for the first time here).
  await expect
    .poll(async () => footerPageLabel(page), { timeout: 45_000 })
    .toMatch(PAGE_LABEL);
  const opened = await footerPageLabel(page);

  let passageCfi = "";
  for (let turn = 0; turn < 8; turn++) {
    const saved = await expectMutation(page, PROGRESS_POST, async () =>
      page.getByTestId("reader-next").click(),
    );
    passageCfi = saved.request.postDataJSON().update.epub_cfi as string;
  }
  const passagePage = await footerPageLabel(page);
  expect(passagePage, "the turns should move the page label").not.toBe(opened);

  // Now rewind the saved position to the front of the book, so "resume" and
  // "the passage" are unmistakably different destinations.
  await gotoReady(page, `/books/${uuid}`);
  const reset = await request.post("/api/rpc/progress", {
    data: {
      update: {
        book_uuid: uuid,
        format: "epub",
        epub_cfi: "epubcfi(/6/2!/4/2/1:0)",
      },
    },
  });
  expect(reset.status(), "rewind saved progress").toBe(200);

  // Opening with ?cfi= must land on the passage's page, not the rewound one.
  await gotoReady(page, `/read/${uuid}?cfi=${encodeURIComponent(passageCfi)}`);
  await expect(page.getByTestId("reader-viewer")).toBeVisible();
  await expect
    .poll(async () => footerPageLabel(page), { timeout: 20_000 })
    .toBe(passagePage);
});

test("keeps reading when the progress save POST fails", async ({
  page,
  request,
}) => {
  const uuid = await fetchBookUuidByTitle(request, PROGRESS_ERR_BOOK.title);

  // Force 500 on every progress save from this page — armed before the first
  // navigation so this test never writes real progress for its book. Pin the
  // exact pathname so `/api/rpc/progress/get` reads pass through untouched.
  await page.route(
    (url) => url.pathname === "/api/rpc/progress",
    async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({ status: 500, body: "forced failure" });
      } else {
        await route.continue();
      }
    },
  );

  await gotoReady(page, `/read/${uuid}`);
  await expect(page.getByTestId("reader-viewer")).toBeVisible();
  await expect
    .poll(async () => footerPageLabel(page), { timeout: 20_000 })
    .toMatch(PAGE_LABEL);

  // Each turn still fires its save (observing the forced 500), and the
  // reader keeps paging normally — persistence is fire-and-forget, so a
  // second turn still attempts its save and no error UI appears.
  await expectMutation(
    page,
    { ...PROGRESS_POST, expectedStatus: 500 },
    async () => page.getByTestId("reader-next").click(),
  );
  await expectMutation(
    page,
    { ...PROGRESS_POST, expectedStatus: 500 },
    async () => page.getByTestId("reader-next").click(),
  );
  await expect(page.getByTestId("reader-viewer")).toBeVisible();
  await expect(page.getByTestId("reader-error")).toHaveCount(0);
});

// Regression for issue #1895: real publisher front matter is full-page image
// markup (a plain <img> or an SVG-wrapped <image>), and paging through
// several short sections in a row — at any speed — must never leave the
// rendition blank or wedged.
test("pages through image front matter without blanking the rendition, even at rapid clicks", async ({
  page,
  request,
}) => {
  const uuid = await fetchBookUuidByTitle(request, FRONTMATTER_BOOK.title);
  await gotoReady(page, `/read/${uuid}`);
  await expect(page.getByTestId("reader-viewer")).toBeVisible();

  // Intentional exception: this regression must inspect rendered EPUB
  // markup to confirm the front-matter images actually occupy real space,
  // not collapse to nothing (AC2 — "render as completely empty spreads" is
  // the issue's own description of the symptom). A rendered bounding box is
  // the more robust signal here than a manual decode probe: it's what a
  // reader actually sees, and it doesn't race the async blob->data URI
  // repair the way polling `naturalWidth` on a throwaway Image() does —
  // Playwright's own `boundingBox()` already waits for layout to settle.
  const viewerFrame = page.frameLocator("#omnibus-viewer iframe");

  // Title page: a full-page plain <img> — the most common real-world shape.
  const titleImg = viewerFrame.locator("img").first();
  await expect(titleImg).toBeVisible();
  await expect
    .poll(async () => (await titleImg.boundingBox())?.height ?? 0, {
      timeout: 15_000,
    })
    .toBeGreaterThan(10);

  // Copyright page: an SVG-wrapped <image> — the shape a real publisher
  // scan uses, and the one that rendered blank while the plain <img> page
  // worked.
  await page.getByTestId("reader-next").click();
  const svgImage = viewerFrame.locator("image").first();
  await expect(svgImage).toBeVisible();
  await expect
    .poll(async () => (await svgImage.boundingBox())?.height ?? 0, {
      timeout: 15_000,
    })
    .toBeGreaterThan(10);

  // Rapid-fire the remaining turns with no waiting between clicks — the
  // condition (~1 click/sec or faster) that wedged the rendition on a real
  // book with no console error (AC1). Three text sections plus the final
  // chapter: five more section-boundary crossings.
  for (let i = 0; i < 5; i++) {
    await page.getByTestId("reader-next").click();
  }
  await expect(page.getByTestId("reader-error")).toHaveCount(0);
  await expect(page.getByTestId("reader-viewer")).toBeVisible();

  // A wedged rendition never recovers going backwards either — the other
  // reported symptom ("prev does not restore it").
  await page.getByTestId("reader-prev").click();
  await expect(page.getByTestId("reader-error")).toHaveCount(0);
  await expect(page.getByTestId("reader-viewer")).toBeVisible();
});

// Regression for issue #2213: epub.js renders a book's own stylesheets
// through URL.createObjectURL when a rule references an internal asset (a
// relative url()), so reading such a book loads a blob: stylesheet. If
// style-src omits blob:, the browser refuses it and every forward page-turn
// breaks with "This book couldn't be loaded." No generated fixture exercised
// this before `standalone-reef`, whose publisher.css carries a relative
// url() — the trivial inlined rule the other fixtures ship (alpha's
// `.calibre { color }`) is never rewritten to a blob, so 54 specs missed the
// broken CSP entirely.
test("reads a book whose stylesheet becomes a blob: URL without a CSP refusal", async ({
  page,
  request,
}) => {
  // Capture only stylesheet CSP refusals — an unrelated CSP console message
  // must neither mask this guard nor falsely trip it. CSP violations reach
  // page.on("console") as browser-emitted error entries, section-iframe ones
  // included.
  const cspStyleViolations: string[] = [];
  page.on("console", (msg) => {
    const text = msg.text();
    if (
      /content security policy/i.test(text) &&
      /style-src|stylesheet/i.test(text)
    ) {
      cspStyleViolations.push(text);
    }
  });

  const uuid = await fetchBookUuidByTitle(request, BLOB_CSS_BOOK.title);
  await gotoReady(page, `/read/${uuid}`);
  await expect(page.getByTestId("reader-viewer")).toBeVisible();

  // Prove the blob path is actually exercised (not a vacuous pass): epub.js
  // rewrites publisher.css's url() and links the rewritten sheet as a blob:
  // inside the section iframe. That link is present whether or not the CSP
  // then blocks it, so it is the honest precondition for the guard below —
  // and its render is what loads (or refuses) the blob stylesheet.
  const blobStylesheetCount = () =>
    page.evaluate(() => {
      const iframe = document.querySelector(
        "#omnibus-viewer iframe",
      ) as HTMLIFrameElement | null;
      const doc = iframe?.contentDocument;
      if (!doc) return -1;
      return Array.from(doc.querySelectorAll("link")).filter((l) =>
        (l as HTMLLinkElement).href.startsWith("blob:"),
      ).length;
    });
  await expect
    .poll(blobStylesheetCount, { timeout: 20_000 })
    .toBeGreaterThan(0);

  // Turn forward — the reported symptom is a forward page-turn breaking on
  // the blob stylesheet load. The reader must stay on its content, never
  // dropping into the "couldn't be loaded" error surface.
  await page.getByTestId("reader-next").click();
  await expect(page.getByTestId("reader-error")).toHaveCount(0);
  await expect(page.getByTestId("reader-viewer")).toBeVisible();

  // The blob: stylesheet loaded without a style-src refusal (issue #2213).
  // Asserted last: the awaits above outlast the browser's console delivery,
  // so a refusal that fired on the styled render is already collected.
  expect(
    cspStyleViolations,
    `blob: stylesheet must load without a CSP refusal:\n${cspStyleViolations.join("\n")}`,
  ).toEqual([]);
});

// A touch context, because the gesture is the subject: without `hasTouch`
// Chromium answers `Input.dispatchTouchEvent` with synthesized *mouse* events
// and the page's touch listeners — the code under test — never run. That also
// suppresses the round page-turn buttons, so the position is parked by
// tapping the forward gutter, the way a touch reader turns a page.
test.describe("two-finger gestures (touch context)", () => {
  test.use({ hasTouch: true });
  // Serial: all three park a position on the one reserved book, and under
  // `fullyParallel` they would be reading each other's turns.
  test.describe.configure({ mode: "default" });

  test("a two-finger swipe over the reader chrome leaves the page where it is", async ({
    page,
    request,
  }) => {
    const uuid = await fetchBookUuidByTitle(request, TWO_FINGER_BOOK.title);
    await gotoReady(page, `/read/${uuid}`);
    await expect(page.getByTestId("reader-viewer")).toBeVisible();
    await expect
      .poll(async () => footerPageLabel(page), { timeout: 20_000 })
      .toMatch(PAGE_LABEL);
    const start = await footerPageLabel(page);

    // Park several pages inside one chapter, and prove that is where we are:
    // the defect settled the page at `scrollLeft` 0 — the current chapter's
    // own first page — so a position that happened to *be* a chapter's first
    // page would assert nothing. Turning until the chapter counter has held
    // still for three turns is that proof.
    let chapter = await chapterCounter(page);
    let held = 0;
    for (let turn = 0; turn < 14 && held < 3; turn++) {
      await expectMutation(page, PROGRESS_POST, async () => tapForward(page));
      const now = await chapterCounter(page);
      held = now === chapter ? held + 1 : 0;
      chapter = now;
    }
    expect(held, "should park several pages inside one chapter").toBe(3);
    const parked = await footerPageLabel(page);
    expect(parked, "the turns should move the page label").not.toBe(start);

    // Two fingers on the top bar: host document, outside `.rd-stage`, so the
    // glue declines the gesture — and declines it before recording the scroll
    // baseline a page drag settles against. The first finger then lifts while
    // the second is still sliding, which used to re-arm that drag with the
    // baseline still at 0 and write it straight to `scrollLeft`.
    const bar = await page.getByTestId("reader-top").boundingBox();
    expect(bar, "reader top bar box").not.toBeNull();
    await twoFingerSwipe(
      page,
      { x: bar!.x + bar!.width / 2, y: bar!.y + bar!.height / 2 },
      { x: 0, y: 24 },
    );

    // Nothing moved under the gesture...
    expect(await footerPageLabel(page)).toBe(parked);

    // ...and the next deliberate turn carries on from where we parked rather
    // than from wherever a jump had left us. Its `expectMutation` is the wait
    // that outlasts the settle the defect animated through — a jump to the
    // chapter start would land this turn back near the chapter's opening
    // pages, not past `parked`.
    await expectMutation(page, PROGRESS_POST, async () => tapForward(page));
    expect(
      footerPageNumber(await footerPageLabel(page)),
      "the turn after the gesture must carry on from the parked page",
    ).toBeGreaterThan(footerPageNumber(parked));
  });

  test("a finger joining a drag from the chrome hands the page back", async ({
    page,
    request,
  }) => {
    const uuid = await fetchBookUuidByTitle(request, TWO_FINGER_BOOK.title);
    await gotoReady(page, `/read/${uuid}`);
    await expect(page.getByTestId("reader-viewer")).toBeVisible();
    await expect
      .poll(async () => footerPageLabel(page), { timeout: 20_000 })
      .toMatch(PAGE_LABEL);
    const parked = await footerPageLabel(page);

    // The drag is armed on the page, and the second finger lands on the top
    // bar — a different document, so the handler holding the drag never sees
    // its `touchstart` and learns about it only from the lift. Abandoning the
    // drag there without settling leaves the page frozen part-turned.
    const bar = await page.getByTestId("reader-top").boundingBox();
    expect(bar, "reader top bar box").not.toBeNull();
    const size = page.viewportSize();
    if (!size) throw new Error("this test needs a viewport");
    const armed = await dragJoinedFromElsewhere(
      page,
      { x: size.width / 2, y: size.height / 2 },
      { x: bar!.x + bar!.width / 2, y: bar!.y + bar!.height / 2 },
    );
    expect(
      armed,
      "the drag should be part-turned before the second finger",
    ).not.toEqual([]);

    await expect
      .poll(async () => strandedOffsets(page), { timeout: 5_000 })
      .toEqual([]);
    expect(await footerPageLabel(page)).toBe(parked);
  });

  test("a tap after a cancelled two-finger gesture still turns the page", async ({
    page,
    request,
  }) => {
    const uuid = await fetchBookUuidByTitle(request, TWO_FINGER_BOOK.title);
    await gotoReady(page, `/read/${uuid}`);
    await expect(page.getByTestId("reader-viewer")).toBeVisible();
    await expect
      .poll(async () => footerPageLabel(page), { timeout: 20_000 })
      .toMatch(PAGE_LABEL);
    const before = await footerPageLabel(page);

    // The system taking a gesture away ends it with `touchcancel`, not a
    // lift. The multi-finger gate has to come down on that too, or the next
    // single-finger tap is swallowed by a sequence that never finished.
    //
    // Cancelled on the very spot the tap will land. The gate is a per-document
    // closure — the handlers are installed once per section document and once
    // for the host — so cancelling on the chrome would raise one document's
    // flag and read another's, and this would be asserting nothing at all.
    //
    // What it pins is the recovery *contract*, which two mechanisms implement
    // redundantly (`touchstart` heals the flag, and `touchcancel` clears it):
    // it goes red when both are removed, not when either one is.
    const size = page.viewportSize();
    if (!size) throw new Error("this test needs a viewport");
    await twoFingerCancel(page, {
      x: size.width * 0.92,
      y: size.height / 2,
    });

    await expectMutation(page, PROGRESS_POST, async () => tapForward(page));
    expect(
      await footerPageLabel(page),
      "the tap after a cancelled gesture must still turn the page",
    ).not.toBe(before);
  });
});
