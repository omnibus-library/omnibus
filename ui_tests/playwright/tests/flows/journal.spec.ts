import { journals } from "../contracts/journals";
import {
  type JournalEntryRef,
  journalMarker,
  TINY_PNG,
} from "../data/journals";
import { FIXTURE_BOOKS } from "../fixtures/epubs";
import { expect, test } from "../fixtures/pageFixtures";
import { failing } from "../utils/api";
import { fetchBookUuidByTitle } from "../utils/ebooks";
import { fixturesDir, seedLibrary } from "../utils/seed";

// Journals are public and global per book, so every test here shares `alpha`'s
// feed and the file runs serially; each test marks its own entries.
test.describe.configure({ mode: "serial" });

const TARGET = FIXTURE_BOOKS.find((b) => b.slug === "alpha")!;

// A seeded highlight is per-(user, book) state, so seeding one on TARGET would
// break reader.spec.ts's empty highlights drawer. `standalone-meadow` is read
// by no other spec.
const HIGHLIGHT_BOOK = FIXTURE_BOOKS.find(
  (b) => b.slug === "standalone-meadow",
)!;

test.describe("book journal", () => {
  test.beforeAll("seed the library", async ({ request }) => {
    await seedLibrary(request, fixturesDir(), FIXTURE_BOOKS.length);
  });

  test("show the journal section layout", async ({
    request,
    bookDetailPage,
  }) => {
    const { journal } = bookDetailPage;
    const uuid = await fetchBookUuidByTitle(request, TARGET.title);

    await test.step("open the book", async () => {
      await bookDetailPage.goto(uuid);
    });

    // The kicker is counts only and this feed carries whatever the serial
    // tests left, so it is pinned to one of its two shapes.
    await test.step("check the journal stop", async () => {
      await bookDetailPage.assertDisplayed();
      await bookDetailPage.topNav.assertDisplayed();
      await expect(journal.section).toBeVisible();
      await expect(journal.kicker).toHaveText(
        /^(No entries yet|\d+ entr(y|ies) from \d+ readers?( · \d+ drafts?)?)$/,
      );
      await expect(journal.newEntryButton).toBeVisible();
    });

    await test.step("open the composer", async () => {
      await journal.openComposer();
    });

    await test.step("check the composer", async () => {
      await expect(journal.composer).toBeVisible();
      await expect(journal.editor).toBeVisible();
      await expect(journal.spoilerHelp).toBeVisible();
      await expect(journal.toolbar).toBeVisible();
      await expect(journal.boldButton).toBeVisible();
      await expect(journal.insertHighlightButton).toBeVisible();
    });
  });

  test.describe("composer", () => {
    test("wrap the selected text in markdown with the toolbar", async ({
      request,
      bookDetailPage,
      expectMutation,
    }) => {
      const { journal } = bookDetailPage;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("open the composer", async () => {
        await bookDetailPage.goto(uuid);
        await journal.openComposer();
      });

      // The markdown source is read back from the hidden mirror.
      await test.step("bold the whole draft", async () => {
        await journal.write("hello world");
        await journal.selectText();
        await journal.bold();
        await expect(journal.markdown).toHaveValue("**hello world**");
      });

      // A line-prefix command prefixes the line rather than wrapping it.
      await test.step("quote the whole draft", async () => {
        await journal.write("a thought");
        await journal.selectText();
        await journal.quote();
        await expect(journal.markdown).toHaveValue("> a thought");
      });

      await test.step("discard the draft", async () => {
        await journal.assertAutosaved();
        await expectMutation(journals.delete(), () => journal.discardDraft());
        await expect(journal.composer).toHaveCount(0);
      });
    });

    test("insert a saved highlight into the draft as a blockquote", async ({
      request,
      bookDetailPage,
      highlightOn,
      expectMutation,
    }) => {
      const { journal } = bookDetailPage;
      const uuid = await fetchBookUuidByTitle(request, HIGHLIGHT_BOOK.title);

      const highlight =
        await test.step("save a highlight through the api", () =>
          highlightOn(uuid));

      await test.step("open the composer", async () => {
        await bookDetailPage.goto(uuid);
        await journal.openComposer();
      });

      await test.step("pick the saved highlight", async () => {
        await journal.openHighlightInserter();
        await expect(journal.highlightsPopover).toBeVisible();
        await journal.insertHighlight(highlight.text);
      });

      await test.step("check it lands as an attributed blockquote", async () => {
        await expect(journal.markdown).toHaveValue(
          new RegExp(`> ${highlight.text}[\\s\\S]*saved from highlights`),
        );
        await expect(journal.highlightsPopover).toHaveCount(0);
      });

      await test.step("discard the draft", async () => {
        await journal.assertAutosaved();
        await expectMutation(journals.delete(), () => journal.discardDraft());
        await expect(journal.composer).toHaveCount(0);
      });
    });

    test("preview the draft as rendered markdown", async ({
      request,
      bookDetailPage,
      expectMutation,
    }) => {
      const { journal } = bookDetailPage;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("open the composer", async () => {
        await bookDetailPage.goto(uuid);
        await journal.openComposer();
      });

      // The preview renders server-sanitized markdown.
      await test.step("preview a bold draft", async () => {
        await journal.write("**bold preview**");
        await expectMutation(journals.preview(), () => journal.togglePreview());
        await expect(journal.previewBold).toHaveText("bold preview");
      });

      await test.step("discard the draft", async () => {
        await journal.assertAutosaved();
        await expectMutation(journals.delete(), () => journal.discardDraft());
        await expect(journal.composer).toHaveCount(0);
      });
    });

    test("publish lists, a quote and paragraphs as structured markup", async ({
      request,
      bookDetailPage,
      createdJournalIds,
      expectMutation,
    }) => {
      const { journal, journalEntry } = bookDetailPage;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);
      const marker = journalMarker("blocks");
      const body = `${marker} intro\n\n1. first\n2. second\n\n- parent\n  - child\n\n> quoted one\nquoted two`;

      await test.step("open the composer", async () => {
        await bookDetailPage.goto(uuid);
        await journal.openComposer();
      });

      // Typed, not filled, so `\n` presses Enter through the editor's own
      // newline handling, the path a real author uses.
      await test.step("type the entry", async () => {
        await journal.type(body);
        // Blank lines and the sub-bullet's indent must survive the round-trip.
        await expect(journal.markdown).toHaveValue(body);
      });

      await test.step("publish the entry", async () => {
        const { response } = await expectMutation(journals.save(), () =>
          journal.publish(),
        );
        const { id }: JournalEntryRef = await response.json();
        createdJournalIds.add(id);
      });

      await test.step("open the entry", async () => {
        await journal.openEntry(marker);
      });

      await test.step("check the markup is structured", async () => {
        await expect(journalEntry.orderedListItems).toHaveCount(2);
        await expect(journalEntry.nestedListItem).toHaveText("child");
        // The lazy continuation line keeps its own row: soft breaks are
        // promoted to <br> on publish.
        await expect(journalEntry.blockquote).toContainText("quoted two");
        await expect(journalEntry.blockquoteBreaks).toHaveCount(1);
      });
    });

    test("upload an image from the toolbar into a captioned figure", async ({
      request,
      bookDetailPage,
      createdJournalIds,
      expectMutation,
    }) => {
      const { journal, journalEntry } = bookDetailPage;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);
      const marker = journalMarker("image");

      await test.step("open the composer", async () => {
        await bookDetailPage.goto(uuid);
        await journal.openComposer();
        await journal.write(`figure test ${marker}`);
      });

      // The upload inserts markdown image syntax at the caret, pointing at the
      // returned serving URL.
      await test.step("upload an image", async () => {
        await expectMutation(journals.uploadImage(), () =>
          journal.uploadImage(TINY_PNG),
        );
        await expect(journal.markdown).toHaveValue(
          new RegExp(
            `figure test ${marker}[\\s\\S]*!\\[Add a caption\\]\\(/api/journals/images/`,
          ),
        );
      });

      await test.step("publish the entry", async () => {
        const { response } = await expectMutation(journals.save(), () =>
          journal.publish(),
        );
        const { id }: JournalEntryRef = await response.json();
        createdJournalIds.add(id);
      });

      // The alt text is the caption.
      await test.step("check the lone image renders as a captioned figure", async () => {
        await journal.openEntry(marker);
        await expect(journalEntry.figureImage).toBeVisible();
        await expect(journalEntry.figureCaption).toHaveText("Add a caption");
      });
    });

    test("hide markdown markers on lines away from the caret", async ({
      request,
      bookDetailPage,
      expectMutation,
    }) => {
      const { journal } = bookDetailPage;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("type two lines", async () => {
        await bookDetailPage.goto(uuid);
        await journal.openComposer();
        // Typed, not filled: the editor only inserts a newline through its
        // Enter handler, and a raw multi-line fill collapses to one line.
        await journal.typeLines(["# Heading line", "**bold line**"]);
        await expect(journal.editorLines).toHaveCount(2);
      });

      // The characters stay in the layout either way.
      await test.step("put the caret on the second line", async () => {
        await journal.focusLine(1);
        await expect(journal.editorLine(1)).toHaveClass(/cm-active/);
        await expect(journal.editorLine(0)).not.toHaveClass(/cm-active/);
        await expect(journal.lineMarker(1)).toHaveCSS("opacity", "0.38");
        await expect(journal.lineMarker(0)).toHaveCSS("opacity", "0");
      });

      await test.step("move the caret to the first line", async () => {
        await journal.focusLine(0);
        await expect(journal.editorLine(0)).toHaveClass(/cm-active/);
        await expect(journal.editorLine(1)).not.toHaveClass(/cm-active/);
        await expect(journal.markdown).toHaveValue(
          "# Heading line\n**bold line**",
        );
      });

      await test.step("discard the draft", async () => {
        await journal.assertAutosaved();
        await expectMutation(journals.delete(), () => journal.discardDraft());
        await expect(journal.composer).toHaveCount(0);
      });
    });

    // A faded list marker leaves nothing behind, so the wrapper paints a
    // substitute bullet over it on every line but the caret's (#2367).
    test("keep a list bullet visible on lines away from the caret", async ({
      request,
      bookDetailPage,
      expectMutation,
    }) => {
      const { journal } = bookDetailPage;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("type a bullet, a task and a plain line", async () => {
        await bookDetailPage.goto(uuid);
        await journal.openComposer();
        await journal.typeLines([
          "- bulleted line",
          "- [x] done line",
          "plain line",
        ]);
        await expect(journal.editorLines).toHaveCount(3);
      });

      // The raw markers stay in the text, so the mirrored markdown is untouched.
      await test.step("put the caret on the plain line", async () => {
        await journal.focusLine(2);
        await expect(journal.editorLine(2)).toHaveClass(/cm-active/);
        await expect.poll(() => journal.listMarkerContent(0)).toBe('"•"');
        await expect.poll(() => journal.listMarkerContent(1)).toBe('"☑"');
        await expect(journal.markdown).toHaveValue(
          "- bulleted line\n- [x] done line\nplain line",
        );
      });

      await test.step("move the caret onto the bullet", async () => {
        await journal.focusLine(0);
        await expect(journal.editorLine(0)).toHaveClass(/cm-active/);
        await expect.poll(() => journal.listMarkerContent(0)).toBe("none");
        await expect.poll(() => journal.listMarkerContent(1)).toBe('"☑"');
      });

      await test.step("discard the draft", async () => {
        await journal.assertAutosaved();
        await expectMutation(journals.delete(), () => journal.discardDraft());
        await expect(journal.composer).toHaveCount(0);
      });
    });

    // Document-end navigation used to be left to the browser, which resolves it
    // against the decoration spans and lands mid-document (#2269).
    test("move the caret to the end and start of the entry", async ({
      request,
      bookDetailPage,
      expectMutation,
    }) => {
      const { journal } = bookDetailPage;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      await test.step("type three lines", async () => {
        await bookDetailPage.goto(uuid);
        await journal.openComposer();
        await journal.typeLines(["# First", "**second**", "third"]);
      });

      await test.step("jump to the end and append", async () => {
        await journal.focusLine(0);
        await journal.press("ControlOrMeta+End");
        await journal.typeAtCaret("!");
        await expect(journal.markdown).toHaveValue(
          "# First\n**second**\nthird!",
        );
      });

      await test.step("jump to the start and prepend", async () => {
        await journal.press("ControlOrMeta+Home");
        await journal.typeAtCaret(">");
        await expect(journal.markdown).toHaveValue(
          "># First\n**second**\nthird!",
        );
      });

      // Shift extends from the selection's anchor, and a Range reports its ends
      // in document order. Selecting backwards and pressing Shift+End must
      // collapse the selection, not re-select everything.
      await test.step("select backwards, then collapse", async () => {
        await journal.press("ControlOrMeta+End");
        await journal.press("Shift+ControlOrMeta+Home");
        await expect
          .poll(() => journal.selectedText())
          .toBe("># First\n**second**\nthird!");
        await journal.press("Shift+ControlOrMeta+End");
        await expect.poll(() => journal.selectedText()).toBe("");
      });

      await test.step("discard the draft", async () => {
        await journal.assertAutosaved();
        await expectMutation(journals.delete(), () => journal.discardDraft());
        await expect(journal.composer).toHaveCount(0);
      });
    });
  });

  test.describe("entries", () => {
    test("publish an entry attributed to the current user", async ({
      request,
      bookDetailPage,
      createdJournalIds,
      expectMutation,
    }) => {
      const { journal, journalEntry } = bookDetailPage;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);
      const marker = journalMarker("journal");

      await test.step("publish an entry", async () => {
        await bookDetailPage.goto(uuid);
        const { response } = await expectMutation(journals.save(), () =>
          journal.publishEntry(`First thoughts ${marker}`),
        );
        const { id }: JournalEntryRef = await response.json();
        createdJournalIds.add(id);
      });

      // The new entry lands in the excerpt ladder; its card carries the
      // author's "you" chip, since the current user owns it.
      await test.step("open the entry", async () => {
        await journal.openEntry(marker);
        await expect(journalEntry.youChip).toBeVisible();
      });
    });

    test("edit a published entry", async ({
      request,
      bookDetailPage,
      journalEntryOn,
      expectMutation,
    }) => {
      const { journal, journalEntry } = bookDetailPage;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);
      const marker = journalMarker("journal-edit");

      await test.step("publish an entry through the api", async () => {
        await journalEntryOn(uuid, `First thoughts ${marker}`);
      });

      await test.step("open the entry", async () => {
        await bookDetailPage.goto(uuid);
        await journal.openEntry(marker);
      });

      // Edit mode swaps the rendered body for a live editor, so the open
      // editor is found on the page, not through the marker.
      await test.step("rewrite the body", async () => {
        await journalEntry.startEdit();
        await journalEntry.rewrite(`Revised thoughts ${marker}`);
        await expectMutation(journals.update(), () => journalEntry.saveEdit());
      });

      await test.step("check the entry shows the new body", async () => {
        await expect(
          journalEntry.entryWithText(`Revised thoughts ${marker}`),
        ).toBeVisible();
      });
    });

    // The delete asks "This can't be undone" first (#1907), so the request
    // fires from the modal's confirm, not the card's Delete.
    test("delete an entry after confirming", async ({
      request,
      bookDetailPage,
      journalEntryOn,
      createdJournalIds,
      expectMutation,
    }) => {
      const { journal, journalEntry } = bookDetailPage;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);
      const marker = journalMarker("journal-delete");

      const { id } = await test.step("publish an entry through the api", () =>
        journalEntryOn(uuid, `Doomed thoughts ${marker}`));

      await test.step("open the entry", async () => {
        await bookDetailPage.goto(uuid);
        await journal.openEntry(marker);
      });

      await test.step("confirm the delete", async () => {
        await journalEntry.startDelete();
        await expectMutation(journals.delete(), () =>
          journalEntry.confirmDelete(),
        );
        createdJournalIds.delete(id);
      });

      await test.step("check the entry left the feed", async () => {
        await expect(journal.ladderRow(marker)).toHaveCount(0);
        await expect(journalEntry.root).toHaveCount(0);
      });
    });

    test("open a long entry whole, filling the backdrop", async ({
      request,
      bookDetailPage,
      createdJournalIds,
      expectMutation,
    }) => {
      const { journal, journalEntry } = bookDetailPage;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);
      const marker = journalMarker("whole");
      // Past both collapse thresholds (900 chars, 12 lines), and taller than the
      // backdrop at any plausible window size, so the cap decides the height.
      const filler = Array.from(
        { length: 30 },
        (_, i) => `- padding line ${i} ${"long enough to matter ".repeat(4)}`,
      ).join("\n");

      await test.step("publish a long entry", async () => {
        await bookDetailPage.goto(uuid);
        const { response } = await expectMutation(journals.save(), () =>
          journal.publishEntry(`${marker} intro\n\n${filler}`),
        );
        const { id }: JournalEntryRef = await response.json();
        createdJournalIds.add(id);
      });

      await test.step("open the entry", async () => {
        await journal.openEntry(marker);
      });

      // Opening the row already asked for the whole entry, so the feed card's
      // "Show more" must not be inherited.
      await test.step("check the entry opens whole", async () => {
        await expect(journalEntry.showMoreButton).toHaveCount(0);
        await expect(journalEntry.collapsedBody).toHaveCount(0);
      });

      // The card takes the room the backdrop has, not the old fixed 640x560 box;
      // its height is capped at the backdrop's box less 36px padding each edge.
      await test.step("check the card fills the backdrop", async () => {
        const overlayBox = await journalEntry.overlayBox();
        const cardBox = await journalEntry.cardBox();
        expect(overlayBox, "the overlay must have a box").not.toBeNull();
        expect(cardBox, "the overlay card must have a box").not.toBeNull();
        expect(cardBox!.width).toBeGreaterThan(640);
        expect(cardBox!.height).toBeGreaterThanOrEqual(overlayBox!.height - 74);
      });
    });

    // The counterpart to the long entry: `max-height`, not `height`, keeps an
    // ordinary entry content-sized instead of a scrolling fixed box.
    test("size an entry that fits to its own content", async ({
      request,
      bookDetailPage,
      createdJournalIds,
      expectMutation,
    }) => {
      const { journal, journalEntry } = bookDetailPage;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);
      const marker = journalMarker("fits");

      await test.step("publish a short entry", async () => {
        await bookDetailPage.goto(uuid);
        const { response } = await expectMutation(journals.save(), () =>
          journal.publishEntry(
            `${marker} intro\n\n- one note\n- another note\n- a third note`,
          ),
        );
        const { id }: JournalEntryRef = await response.json();
        createdJournalIds.add(id);
      });

      await test.step("open the entry", async () => {
        await journal.openEntry(marker);
      });

      await test.step("check the card is shorter than the backdrop and does not scroll", async () => {
        const overlayBox = await journalEntry.overlayBox();
        const cardBox = await journalEntry.cardBox();
        expect(overlayBox, "the overlay must have a box").not.toBeNull();
        expect(cardBox, "the overlay card must have a box").not.toBeNull();
        expect(cardBox!.height).toBeLessThan(overlayBox!.height - 74);
        // Nothing to scroll: the whole entry is on screen at once.
        expect(await journalEntry.cardOverflow()).toBeLessThanOrEqual(1);
      });
    });

    // The flow scroller once carried the scrim's `backdrop-filter`, which made it
    // the containing block for the fixed overlay, so a scrolled page rendered the
    // overlay `scrollTop` pixels above the viewport (#2529).
    test("open a readable entry from a scrolled page", async ({
      request,
      bookDetailPage,
      createdJournalIds,
      expectMutation,
    }) => {
      const { journal, journalEntry } = bookDetailPage;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);
      const marker = journalMarker("scrolled-open");

      await test.step("publish an entry", async () => {
        await bookDetailPage.goto(uuid);
        const { response } = await expectMutation(journals.save(), () =>
          journal.publishEntry(
            `Reading this one back from halfway down the page. ${marker}`,
          ),
        );
        const { id }: JournalEntryRef = await response.json();
        createdJournalIds.add(id);
      });

      await test.step("scroll the entry's row into view", async () => {
        await journal.scrollRowIntoView(marker);
        expect(
          await journal.flowScrollTop(),
          "the flow scroller must have scrolled for this to bite",
        ).toBeGreaterThan(0);
      });

      await test.step("open the entry", async () => {
        await journal.openEntry(marker);
      });

      // `toBeVisible` is not enough: an element positioned entirely outside the
      // viewport still satisfies it, which is why earlier coverage passed.
      await test.step("check the entry is on screen", async () => {
        await expect(journalEntry.entryWithText(marker)).toBeInViewport();
        await expect(journalEntry.closeButton).toBeInViewport();
      });

      // Both axes: the bug also confined the backdrop to the 57%-wide flow
      // column, so a vertical-only check would let a column-sized one pass.
      await test.step("check the backdrop covers the viewport", async () => {
        const box = await journalEntry.overlayBox();
        const viewport = journalEntry.viewportSize();
        expect(box, "the overlay must have a box").not.toBeNull();
        expect(viewport, "the test needs a viewport size").not.toBeNull();
        expect(box!.y).toBeGreaterThanOrEqual(0);
        expect(box!.y + box!.height).toBeGreaterThan(viewport!.height / 2);
        expect(box!.x).toBeLessThanOrEqual(1);
        expect(box!.width).toBeGreaterThan(viewport!.width * 0.95);
      });
    });
  });

  test.describe("spoilers", () => {
    test("reveal a blurred spoiler on click", async ({
      request,
      bookDetailPage,
      createdJournalIds,
      expectMutation,
    }) => {
      const { journal, journalEntry } = bookDetailPage;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);
      const marker = journalMarker("spoiler");

      await test.step("publish an entry with a spoiler", async () => {
        await bookDetailPage.goto(uuid);
        const { response } = await expectMutation(journals.save(), () =>
          journal.publishEntry(`reveal ${marker}: ||the secret||`),
        );
        const { id }: JournalEntryRef = await response.json();
        createdJournalIds.add(id);
      });

      // A `role="button"` span, so `aria-expanded` reflects its state.
      await test.step("open the entry and check the spoiler is blurred", async () => {
        await journal.openEntry(marker);
        await expect(journalEntry.spoiler).toHaveText("the secret");
        await expect(journalEntry.spoiler).not.toHaveClass(/revealed/);
        await expect(journalEntry.spoiler).toHaveAttribute(
          "aria-expanded",
          "false",
        );
      });

      await test.step("click the spoiler", async () => {
        await journalEntry.revealSpoilerWithClick();
        await expect(journalEntry.spoiler).toHaveClass(/revealed/);
        await expect(journalEntry.spoiler).toHaveAttribute(
          "aria-expanded",
          "true",
        );
      });
    });

    // Typed, not filled: only the editor's own newline handling produces a real
    // `<ul>`, and the bug is how the spoiler sits inside its list item.
    test("wrap a spoiler too wide for its line inside a list", async ({
      request,
      bookDetailPage,
      createdJournalIds,
      expectMutation,
    }) => {
      const { journal, journalEntry } = bookDetailPage;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);
      const marker = journalMarker("wrap");
      const long = "a spoiler far too long to sit on one line ".repeat(5);

      await test.step("publish a list item holding a long spoiler", async () => {
        await bookDetailPage.goto(uuid);
        await journal.openComposer();
        await journal.type(`${marker} intro\n\n- ||${long}||`);
        const { response } = await expectMutation(journals.save(), () =>
          journal.publish(),
        );
        const { id }: JournalEntryRef = await response.json();
        createdJournalIds.add(id);
      });

      await test.step("open the entry", async () => {
        await journal.openEntry(marker);
      });

      await test.step("check the spoiler wraps beside the list marker", async () => {
        const layout = await journalEntry.spoilerInListLayout();
        expect(layout.inList, "the fixture must build a real list item").toBe(
          true,
        );
        // An inline span flows across lines as prose, with no box to centre its
        // text in and no atomic box whose baseline drags the marker down.
        expect(
          layout.fragments,
          "the spoiler must wrap for this spec to cover the bug",
        ).toBeGreaterThan(1);
        // Its first fragment sits on the item's first line, beside the marker.
        expect(layout.firstTopDelta).toBeLessThan(layout.lineHeight);
      });
    });

    test("wrap a spoiler as prose beside the punctuation before it", async ({
      request,
      bookDetailPage,
      createdJournalIds,
      expectMutation,
    }) => {
      const { journal, journalEntry } = bookDetailPage;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);
      const marker = journalMarker("prose");

      // The report's reproduction: an opening bracket right before a spoiler
      // too wide for what is left of its line.
      await test.step("publish a spoiler inside brackets", async () => {
        await bookDetailPage.goto(uuid);
        const { response } = await expectMutation(journals.save(), () =>
          journal.publishEntry(
            `${marker} It's a happy ending and one that you can imagine going in different directions (||war continues, constant hardships for Darrow, Mustang, and Pax forever... or war ends & peace forever||)`,
          ),
        );
        const { id }: JournalEntryRef = await response.json();
        createdJournalIds.add(id);
      });

      await test.step("open the entry", async () => {
        await journal.openEntry(marker);
      });

      await test.step("check the bracket stays on the spoiler's line", async () => {
        const layout = await journalEntry.measureSpoilerInNarrowParagraph();
        expect(layout.bracket).toBe("(");
        // A `<button>` laid out one atomic box on a line of its own; a span
        // continues the current line and wraps onto the next.
        expect(layout.fragments).toBeGreaterThan(1);
        expect(
          layout.sameLine,
          "the ( must not be stranded on its own line",
        ).toBe(true);
      });
    });

    test("toggle a spoiler from the keyboard", async ({
      request,
      bookDetailPage,
      createdJournalIds,
      expectMutation,
    }) => {
      const { journal, journalEntry } = bookDetailPage;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);
      const marker = journalMarker("spoiler-kb");

      // The spoiler is the card's only interactive element, so Tab, Enter and
      // Space unambiguously drive it.
      await test.step("publish an entry holding only a spoiler control", async () => {
        await bookDetailPage.goto(uuid);
        const { response } = await expectMutation(journals.save(), () =>
          journal.publishEntry(`keyboard ${marker}: ||hidden reveal||`),
        );
        const { id }: JournalEntryRef = await response.json();
        createdJournalIds.add(id);
      });

      // Announced as a named, collapsed control, with its text not read out
      // before it is revealed, and in the focus order, not only focusable by script.
      await test.step("open the entry and check the spoiler is a collapsed control", async () => {
        await journal.openEntry(marker);
        await expect(journalEntry.revealSpoilerButton).toHaveAttribute(
          "aria-expanded",
          "false",
        );
        await expect(journalEntry.revealedSpoiler("hidden reveal")).toHaveCount(
          0,
        );
        await expect(journalEntry.spoilerText).toHaveAttribute(
          "aria-hidden",
          "true",
        );
        await expect(journalEntry.revealSpoilerButton).toHaveAttribute(
          "tabindex",
          "0",
        );
      });

      await test.step("reveal the spoiler with Enter", async () => {
        await journalEntry.focusSpoiler();
        await expect(journalEntry.revealSpoilerButton).toBeFocused();
        await journalEntry.press("Enter");
        // Revealed, it is named by its text and reports itself expanded.
        const revealed = journalEntry.revealedSpoiler("hidden reveal");
        await expect(revealed).toHaveClass(/revealed/);
        await expect(revealed).toHaveAttribute("aria-expanded", "true");
      });

      // Space also scrolls the page by default, which the control must cancel.
      await test.step("hide the spoiler again with Space", async () => {
        await journalEntry.watchSpaceKey();
        await journalEntry.press("Space");
        await expect(journalEntry.revealSpoilerButton).not.toHaveClass(
          /revealed/,
        );
        await expect(journalEntry.revealSpoilerButton).toHaveAttribute(
          "aria-expanded",
          "false",
        );
        expect(await journalEntry.spaceKeyWasPrevented()).toBe(true);
      });
    });
  });

  test.describe("drafts", () => {
    test("save a draft that stays marked as a draft", async ({
      request,
      bookDetailPage,
      createdJournalIds,
      expectMutation,
    }) => {
      const { journal, journalEntry } = bookDetailPage;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);
      const marker = journalMarker("draft");

      await test.step("save a draft", async () => {
        await bookDetailPage.goto(uuid);
        await journal.openComposer();
        await journal.write(`Draft thoughts ${marker}`);
        const { response } = await expectMutation(journals.save(), () =>
          journal.saveDraft(),
        );
        const { id }: JournalEntryRef = await response.json();
        createdJournalIds.add(id);
      });

      // The composer closes and the entry lands in the ladder with a Draft
      // chip on its row; drafts are owner-private, so only this user sees it.
      await test.step("check the feed marks it as a draft", async () => {
        await expect(journal.draftChipRow).toBeVisible();
        await journal.openEntry(marker);
        await expect(journalEntry.draftChip).toBeVisible();
      });
    });

    test("publish a draft from its card", async ({
      request,
      bookDetailPage,
      journalEntryOn,
      expectMutation,
    }) => {
      const { journal, journalEntry } = bookDetailPage;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);
      const marker = journalMarker("draft-publish");

      await test.step("save a draft through the api", async () => {
        await journalEntryOn(uuid, `Draft thoughts ${marker}`, "draft");
      });

      await test.step("open the draft", async () => {
        await bookDetailPage.goto(uuid);
        await journal.openEntry(marker);
        await expect(journalEntry.draftChip).toBeVisible();
      });

      await test.step("publish it", async () => {
        await expectMutation(journals.update(), () =>
          journalEntry.publishDraft(),
        );
      });

      await test.step("check the card is no longer a draft", async () => {
        await expect(journalEntry.draftChip).toHaveCount(0);
        await expect(journalEntry.publishDraftButton).toHaveCount(0);
      });
    });

    test("autosave a draft while typing and discard it on cancel", async ({
      request,
      bookDetailPage,
      createdJournalIds,
      expectMutation,
    }) => {
      const { journal } = bookDetailPage;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);
      const marker = journalMarker("autosave");

      await test.step("open the composer", async () => {
        await bookDetailPage.goto(uuid);
        await journal.openComposer();
      });

      // Typing arms the 2s debounce, which creates the draft without any click.
      const draft =
        await test.step("type and wait for the autosave", async () => {
          const { response } = await expectMutation(journals.create(), () =>
            journal.write(`Autosaved thoughts ${marker}`),
          );
          const { id }: JournalEntryRef = await response.json();
          createdJournalIds.add(id);
          await expect(journal.autosavedNote).toContainText("Auto-saved");
          return id;
        });

      // Cancel discards the autosaved draft row, leaving nothing in the feed.
      await test.step("cancel the composer", async () => {
        await expectMutation(journals.delete(), () => journal.discardDraft());
        createdJournalIds.delete(draft);
      });

      await test.step("check nothing is left behind", async () => {
        await expect(journal.composer).toHaveCount(0);
        await expect(journal.ladderRow(marker)).toHaveCount(0);
      });
    });
  });

  test.describe("failures", () => {
    test("keep the draft when publishing fails", async ({
      request,
      bookDetailPage,
      expectMutation,
    }) => {
      const { journal } = bookDetailPage;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);

      // The debounced autosave may already have created the draft row, turning
      // the publish into an update, so both routes fail.
      await test.step("open the composer while saves fail", async () => {
        await bookDetailPage.goto(uuid);
        await bookDetailPage.forceServerError(journals.save());
        await journal.openComposer();
        await journal.write("this will fail");
      });

      await test.step("publish the draft", async () => {
        await expectMutation(failing(journals.save()), () => journal.publish());
      });

      await test.step("check the composer stays open with the draft and an error", async () => {
        await expect(journal.composer).toBeVisible();
        await expect(journal.markdown).toHaveValue("this will fail");
        await expect(journal.composerError).toBeVisible();
      });
    });

    // The inline error was once gated on `!is_owner`, so an owner never saw a
    // failed Delete (#901).
    test("retry a failed delete on the entry card", async ({
      request,
      bookDetailPage,
      createdJournalIds,
      expectMutation,
    }) => {
      const { journal, journalEntry } = bookDetailPage;
      const uuid = await fetchBookUuidByTitle(request, TARGET.title);
      const marker = journalMarker("journal-delete-fail");

      const entryId = await test.step("publish an entry", async () => {
        await bookDetailPage.goto(uuid);
        const { response } = await expectMutation(journals.save(), () =>
          journal.publishEntry(`Doomed thoughts ${marker}`),
        );
        const { id }: JournalEntryRef = await response.json();
        createdJournalIds.add(id);
        await journal.openEntry(marker);
        return id;
      });

      await test.step("confirm a delete while deletes fail", async () => {
        await bookDetailPage.forceServerError(journals.delete());
        await journalEntry.startDelete();
        await expectMutation(failing(journals.delete()), () =>
          journalEntry.confirmDelete(),
        );
      });

      await test.step("check the card stays with an error", async () => {
        await expect(journalEntry.entryWithText(marker)).toBeVisible();
        await expect(journalEntry.errorAlert).toBeVisible();
      });

      // A failed delete leaves the confirm modal open, so the retry goes
      // through it rather than the card's Delete, which the modal now covers.
      await test.step("retry through the open confirm", async () => {
        await bookDetailPage.stopForcingServerError(journals.delete());
        await expectMutation(journals.delete(), () =>
          journalEntry.confirmDelete(),
        );
        createdJournalIds.delete(entryId);
      });

      await test.step("check the entry is gone", async () => {
        await expect(journalEntry.entryWithText(marker)).toHaveCount(0);
      });
    });
  });
});
