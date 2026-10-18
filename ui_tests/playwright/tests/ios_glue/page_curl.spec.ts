import { buildChapterEpub } from "../data/iosGlue";
import { expect, test } from "../fixtures/pageFixtures";

const PROSE = Array.from(
  { length: 30 },
  (_, i) =>
    `<p>Paragraph ${i + 1}. The tide came in the way bad news does, quietly, and nobody on the quay said a word about it until the lamps were lit.</p>`,
).join("\n");
const SHORT = "<p>The lamps along the quay were lit.</p>";

// The glue's half of the iOS page curl: it shows a neighbouring page for the
// host to snapshot, lands a turn the host drew, and leaves the host any swipe
// or gutter tap it can curl.
test.describe("ios reader page curl", () => {
  test.describe("peeking and landing", () => {
    test.use({ viewport: { width: 402, height: 874 } });

    test.describe("inside a section", () => {
      test.beforeEach("open a long chapter", async ({ iosGluePage }) => {
        await iosGluePage.openBook(await buildChapterEpub(PROSE));
      });

      test("show the next page on a peek without moving the reader", async ({
        iosGluePage,
      }) => {
        const before = await iosGluePage.sectionPosition();

        await test.step("peek at the next page", async () => {
          expect(await iosGluePage.peek(1)).toBe(true);
        });

        await test.step("check the page shifts and the reader stays put", async () => {
          const peeked = await iosGluePage.sectionPosition();
          expect(peeked.scroll, "a peek leaves epub.js where it was").toBe(
            before.scroll,
          );
          expect(await iosGluePage.peekDistance()).toBeGreaterThan(0);
        });

        await test.step("put the page back", async () => {
          expect(await iosGluePage.unpeek()).toBe(true);
        });

        await test.step("check no offset is left drawn", async () => {
          expect((await iosGluePage.sectionPosition()).offset).toBe("");
        });
      });

      test("land a turn on the page the peek showed", async ({
        iosGluePage,
      }) => {
        const before = await iosGluePage.sectionPosition();
        const cfiBefore = (await iosGluePage.relocates()).at(-1)?.cfi;

        const shift =
          await test.step("peek at the next page, then put it back", async () => {
            expect(await iosGluePage.peek(1)).toBe(true);
            const distance = await iosGluePage.peekDistance();
            expect(await iosGluePage.unpeek()).toBe(true);
            return distance;
          });

        await test.step("land the turn", async () => {
          expect(await iosGluePage.turnInstant(1)).toBe(true);
        });

        await test.step("check the turn landed on the page the peek showed", async () => {
          const landed = await iosGluePage.sectionPosition();
          expect(
            landed.scroll,
            "the turn lands on the page the peek showed",
          ).toBe(before.scroll + shift);
          expect(landed.offset).toBe("");
          const last = (await iosGluePage.relocates()).at(-1);
          expect(last?.cfi).not.toBe(cfiBefore);
          expect(last?.echo, "a landed turn is movement").toBe(false);
        });
      });

      test("settle a capture only once a slide has finished drawing", async ({
        iosGluePage,
      }) => {
        const before = await iosGluePage.sectionPosition();

        await test.step("turn with a slide", async () => {
          await iosGluePage.turnSlide(1);
        });

        await test.step("check the capture waits out the slide", async () => {
          expect((await iosGluePage.whenSettled()).columns).toBe(1);
          const settled = await iosGluePage.sectionPosition();
          expect(settled.offset, "no slide is still drawing").toBe("");
          expect(settled.scroll).toBeGreaterThan(before.scroll);
        });
      });

      test("offer nothing to peek at or turn to before the first page", async ({
        iosGluePage,
      }) => {
        const before = await iosGluePage.sectionPosition();

        await test.step("ask for the page before the first", async () => {
          expect(await iosGluePage.neighbourKind(-1)).toBe("none");
          expect(await iosGluePage.peek(-1)).toBe(false);
          expect(await iosGluePage.turnInstant(-1)).toBe(false);
        });

        await test.step("check the reader has not moved", async () => {
          expect(await iosGluePage.sectionPosition()).toEqual(before);
        });
      });
    });

    test.describe("at a chapter's end", () => {
      test.beforeEach(
        "open a short chapter followed by a long one",
        async ({ iosGluePage }) => {
          const epub = await buildChapterEpub(SHORT, {
            chapters: [PROSE],
            toc: [
              ["One", "chapter.xhtml"],
              ["Two", "chapter2.xhtml"],
            ],
          });
          await iosGluePage.openBook(epub);
        },
      );

      test("report the next page as across a section", async ({
        iosGluePage,
      }) => {
        await test.step("check what the host decides by", async () => {
          expect(
            await iosGluePage.whenSettled(),
            "what the host decides by",
          ).toEqual({
            columns: 1,
            // The stage is inset 10px a side, so its middle is the window's.
            spine: 201,
            next: "section",
            prev: "none",
          });
        });

        await test.step("check the next page is a section with nothing to peek at", async () => {
          expect(await iosGluePage.neighbourKind(1)).toBe("section");
          expect(
            await iosGluePage.peek(1),
            "an unlaid chapter has no pixels",
          ).toBe(false);
        });
      });

      test("cross into the next section on a turn", async ({ iosGluePage }) => {
        await test.step("land a turn forward", async () => {
          expect(await iosGluePage.turnInstant(1)).toBe(true);
        });

        await test.step("check the reader is in the next chapter", async () => {
          await expect
            .poll(
              async () => (await iosGluePage.relocates()).at(-1)?.chapterTitle,
            )
            .toBe("Two");
          expect(await iosGluePage.neighbourKind(-1)).toBe("section");
        });
      });
    });
  });

  test.describe("a two-page spread", () => {
    test.use({ viewport: { width: 1000, height: 700 } });

    test.beforeEach(
      "open a long chapter as a spread",
      async ({ iosGluePage }) => {
        await iosGluePage.openBook(await buildChapterEpub(PROSE), {
          spread: "auto",
        });
      },
    );

    test("put the spine where the columns meet", async ({ iosGluePage }) => {
      await test.step("check the columns and the spine", async () => {
        const settled = await iosGluePage.whenSettled();
        expect(settled.columns).toBe(2);
        expect(settled.spine, "the middle of a stage inset 10px a side").toBe(
          500,
        );
      });
    });

    test("show the whole next spread on a peek", async ({ iosGluePage }) => {
      await test.step("peek at the next spread", async () => {
        expect(await iosGluePage.peek(1)).toBe(true);
      });

      await test.step("check both columns move", async () => {
        expect(
          await iosGluePage.peekDistance(),
          "both columns move, so the snapshot is the next spread",
        ).toBe(980);
      });
    });
  });

  test.describe("who turns the page", () => {
    test.use({ viewport: { width: 402, height: 874 }, hasTouch: true });

    test.beforeEach("open a long chapter", async ({ iosGluePage }) => {
      await iosGluePage.openBook(await buildChapterEpub(PROSE));
    });

    test("leave a swipe toward a page the host can curl to the host", async ({
      iosGluePage,
    }) => {
      const before = await iosGluePage.sectionPosition();

      await test.step("tell the glue the host curls the next page", async () => {
        await iosGluePage.setCurlReady({ on: true, next: true, prev: false });
      });

      const drawn = await test.step("swipe left", async () => {
        return iosGluePage.swipeLeft();
      });

      await test.step("check the glue drew no drag and left the page", async () => {
        expect(drawn, "the glue drew no drag").toBe("");
        expect((await iosGluePage.sectionPosition()).scroll).toBe(
          before.scroll,
        );
      });
    });

    test("slide on a swipe toward a page the host can't curl", async ({
      iosGluePage,
    }) => {
      const before = await iosGluePage.sectionPosition();

      await test.step("tell the glue the host curls the next page", async () => {
        await iosGluePage.setCurlReady({ on: true, next: true, prev: false });
      });

      await test.step("swipe left and leave it to the host", async () => {
        expect(await iosGluePage.swipeLeft(), "the glue drew no drag").toBe("");
      });

      await test.step("tell the glue the host curls no page", async () => {
        await iosGluePage.setCurlReady({ on: true, next: false, prev: false });
      });

      const drawn = await test.step("swipe left", async () => {
        return iosGluePage.swipeLeft();
      });

      await test.step("check the glue drew the drag and slid to the next page", async () => {
        expect(drawn, "the glue drew the drag").not.toBe("");
        await expect
          .poll(async () => (await iosGluePage.sectionPosition()).scroll)
          .toBeGreaterThan(before.scroll);
      });
    });

    test.describe("during a peek", () => {
      test("hold off a swipe that would drag the shifted page", async ({
        iosGluePage,
      }) => {
        // Swipes are the glue's here, so only the peek can be what holds one off.
        await test.step("tell the glue the host curls no page", async () => {
          await iosGluePage.setCurlReady({
            on: true,
            next: false,
            prev: false,
          });
        });

        await test.step("peek at the next page", async () => {
          expect(await iosGluePage.peek(1)).toBe(true);
        });

        const peeked = await iosGluePage.sectionPosition();

        const drawn = await test.step("swipe left", async () => {
          return iosGluePage.swipeLeft();
        });

        await test.step("check the peek's shift stands", async () => {
          expect(drawn, "the peek's shift stands").toBe(peeked.offset);
          expect(await iosGluePage.sectionPosition()).toEqual(peeked);
        });
      });

      test("pass a tap on the gutter to the host", async ({ iosGluePage }) => {
        await test.step("tell the glue the host curls no page", async () => {
          await iosGluePage.setCurlReady({
            on: true,
            next: false,
            prev: false,
          });
        });

        await test.step("peek at the next page", async () => {
          expect(await iosGluePage.peek(1)).toBe(true);
        });

        await test.step("tap the forward gutter", async () => {
          await iosGluePage.tapNextGutter();
        });

        await test.step("check the host is asked to turn forward", async () => {
          await expect.poll(() => iosGluePage.turnRequests()).toEqual(["1"]);
        });
      });
    });

    test.describe("gutter taps", () => {
      test("leave both gutter taps to the host while it curls", async ({
        iosGluePage,
      }) => {
        const before = await iosGluePage.sectionPosition();

        await test.step("tell the glue the host is curling", async () => {
          await iosGluePage.setCurlReady({
            on: true,
            next: false,
            prev: false,
          });
        });

        await test.step("tap each gutter", async () => {
          await iosGluePage.tapNextGutter();
          await iosGluePage.tapPreviousGutter();
        });

        await test.step("check the host is asked for both turns and the page stays put", async () => {
          await expect
            .poll(() => iosGluePage.turnRequests())
            .toEqual(["1", "-1"]);
          expect((await iosGluePage.sectionPosition()).scroll).toBe(
            before.scroll,
          );
        });
      });

      test("slide on a gutter tap while the host is not curling", async ({
        iosGluePage,
      }) => {
        const before = await iosGluePage.sectionPosition();

        await test.step("tell the glue the host is curling", async () => {
          await iosGluePage.setCurlReady({
            on: true,
            next: false,
            prev: false,
          });
        });

        await test.step("tap the forward gutter and leave it to the host", async () => {
          await iosGluePage.tapNextGutter();
          await expect.poll(() => iosGluePage.turnRequests()).toEqual(["1"]);
        });

        await test.step("tell the glue the host is not curling", async () => {
          await iosGluePage.setCurlReady({
            on: false,
            next: false,
            prev: false,
          });
        });

        await test.step("tap the forward gutter", async () => {
          await iosGluePage.tapNextGutter();
        });

        await test.step("check the glue slid to the next page and asked the host for nothing more", async () => {
          await expect
            .poll(async () => (await iosGluePage.sectionPosition()).scroll)
            .toBeGreaterThan(before.scroll);
          expect(await iosGluePage.turnRequests()).toEqual(["1"]);
        });
      });
    });
  });
});
