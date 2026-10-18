import { resolve } from "node:path";

import { uploads } from "../contracts/uploads";
import { TINY_PNG } from "../data/covers";
import { expect, test } from "../fixtures/pageFixtures";
import { failing } from "../utils/api";
import { audiobookFixturesDir, fixturesDir } from "../utils/seed";

// Two creators, a series, a publisher, a date and a cover: every field the
// review form shows.
const SAMPLE_EPUB = resolve(fixturesDir(), "generated", "beta.epub");
// Fetched with the fixtures release; its Info dict carries a title and author.
const SAMPLE_PDF = resolve(fixturesDir(), "public_domain", "flatland.pdf");

// Two chapters that the inspect endpoint groups into one book.
const AUDIOBOOK_PARTS = ["chapter01.mp3", "chapter02.mp3"].map((chapter) =>
  resolve(
    audiobookFixturesDir(),
    "generated",
    "grace_hopper_series",
    "the_compiled_tales",
    chapter,
  ),
);

test.describe("add books page", () => {
  test("show the add-books layout", async ({ addBooksPage }) => {
    await test.step("open the add-books page", async () => {
      await addBooksPage.goto();
    });

    await test.step("check the picker shows", async () => {
      await addBooksPage.assertDisplayed();
      await addBooksPage.topNav.assertDisplayed();
      // One picker serves every format: the extension of what is picked decides
      // the ingest, so there is no ebook/audiobook toggle to click first.
      await expect(addBooksPage.fileInput).toBeVisible();
      await expect(addBooksPage.fileInput).toHaveAttribute("accept", /\.epub/);
      await expect(addBooksPage.fileInput).toHaveAttribute("accept", /\.pdf/);
      await expect(addBooksPage.fileInput).toHaveAttribute("accept", /\.m4b/);
      await expect(addBooksPage.fileInput).toHaveAttribute("multiple");
      await expect(addBooksPage.formatsHint).toBeVisible();
      await expect(addBooksPage.ebookTypeToggle).toHaveCount(0);
      await expect(addBooksPage.audiobookTypeToggle).toHaveCount(0);
    });

    await test.step("check nothing is up for review", async () => {
      await expect(addBooksPage.review).toHaveCount(0);
    });
  });

  test("open the review form from an uploaded epub without creating anything", async ({
    addBooksPage,
    expectMutation,
  }) => {
    const form = addBooksPage.form;

    await test.step("open the add-books page", async () => {
      await addBooksPage.goto();
    });
    const commits = addBooksPage.recordCommitRequests();

    await test.step("pick the sample epub", async () => {
      await expectMutation(uploads.inspectEbook(), () =>
        addBooksPage.pickFiles(SAMPLE_EPUB),
      );
      await expect(addBooksPage.review).toBeVisible();
    });

    await test.step("check the form carries the file's metadata", async () => {
      await expect(form.titleField).toHaveValue("Beta in the Series");
      // Both creators become chips, so the form never under-reports what it
      // will save (#2355).
      await expect(form.authorChip("Grace Hopper")).toBeVisible();
      await expect(form.authorChip("Margaret Hamilton")).toBeVisible();
      await expect(form.publisherField).toHaveValue("Omnibus Test Press");
      await expect(form.publishedField).toHaveValue("1969-07-20");
      await expect(form.seriesField).toHaveValue("Pioneers");
      await expect(form.bookNumberField).toHaveValue("1");
      // The cover is shown inline, because there is no cover route yet.
      await expect(form.coverPreviewImage).toHaveAttribute(
        "src",
        /^data:image\/webp;base64,/,
      );
      await expect(form.coverHintText).toHaveText("extracted from file");
    });

    await test.step("check the commit is offered and nothing was sent", async () => {
      await expect(form.saveButton).toHaveText("Add to library");
      await expect(form.saveButton).toBeEnabled();
      expect(commits).toEqual([]);
    });
  });

  test("open the review form from an uploaded pdf", async ({
    addBooksPage,
    expectMutation,
  }) => {
    const form = addBooksPage.form;

    await test.step("open the add-books page", async () => {
      await addBooksPage.goto();
    });

    await test.step("pick the sample pdf", async () => {
      await expectMutation(uploads.inspectEbook(), () =>
        addBooksPage.pickFiles(SAMPLE_PDF),
      );
    });

    // The Info dict fills both fields, because a PDF goes through the parser
    // the scan uses: the form shows what the library would index.
    await test.step("check the form carries the pdf's title and author", async () => {
      await expect(addBooksPage.review).toBeVisible();
      await expect(form.titleField).toHaveValue(
        "Flatland: A Romance of Many Dimensions",
      );
      await expect(form.authorChip("Edwin Abbott Abbott")).toBeVisible();
    });
  });

  test("stage a picked cover instead of writing it", async ({
    addBooksPage,
    expectMutation,
  }) => {
    const form = addBooksPage.form;

    await test.step("open the add-books page", async () => {
      await addBooksPage.goto();
    });
    const commits = addBooksPage.recordCommitRequests();

    await test.step("pick the sample epub", async () => {
      await expectMutation(uploads.inspectEbook(), () =>
        addBooksPage.pickFiles(SAMPLE_EPUB),
      );
      await expect(addBooksPage.review).toBeVisible();
    });

    await test.step("pick a cover image", async () => {
      await addBooksPage.stageCover(TINY_PNG);
    });

    await test.step("check the sidebar says the pick goes with the book", async () => {
      await expect(form.coverHintText).toHaveText(
        "your image · saved with the book",
      );
      await expect(form.coverReplacedNote).toHaveText(
        "Cover replaced · saved with the book",
      );
    });

    await test.step("take the staged cover back", async () => {
      await form.removeCoverOverride();
      await expect(form.coverHintText).toHaveText("extracted from file");
      await expect(form.removeCoverOverrideButton).toHaveCount(0);
    });

    // There is no book yet, so no cover route can have been written to.
    await test.step("check nothing was sent", async () => {
      expect(commits).toEqual([]);
    });
  });

  test("start over without sending anything", async ({
    addBooksPage,
    expectMutation,
  }) => {
    await test.step("open the add-books page", async () => {
      await addBooksPage.goto();
    });
    const commits = addBooksPage.recordCommitRequests();

    await test.step("pick the sample epub", async () => {
      await expectMutation(uploads.inspectEbook(), () =>
        addBooksPage.pickFiles(SAMPLE_EPUB),
      );
      await expect(addBooksPage.review).toBeVisible();
    });

    await test.step("start over", async () => {
      await addBooksPage.form.discard();
    });

    await test.step("check the picker is back and nothing was sent", async () => {
      await expect(addBooksPage.review).toHaveCount(0);
      await expect(addBooksPage.fileInput).toBeVisible();
      expect(commits).toEqual([]);
    });
  });

  test("show an error when inspect fails", async ({
    addBooksPage,
    expectMutation,
  }) => {
    await test.step("open the add-books page", async () => {
      await addBooksPage.goto();
    });

    await test.step("pick the sample epub while the server fails", async () => {
      await addBooksPage.forceServerError(uploads.inspectEbook());
      await expectMutation(failing(uploads.inspectEbook()), () =>
        addBooksPage.pickFiles(SAMPLE_EPUB),
      );
    });

    await test.step("check the status reports it and no form opens", async () => {
      await expect(addBooksPage.statusMessage).toBeVisible();
      await expect(addBooksPage.statusMessage).toHaveClass(/error/);
      await expect(addBooksPage.review).toHaveCount(0);
    });
  });

  test("open the review form from a multi-part mp3 audiobook", async ({
    addBooksPage,
    expectMutation,
  }) => {
    const form = addBooksPage.form;

    await test.step("open the add-books page", async () => {
      await addBooksPage.goto();
    });

    // Both parts go in one pick, and the extension alone routes them to the
    // audiobook ingest.
    await test.step("pick both mp3 parts", async () => {
      await expectMutation(uploads.inspectAudiobook(), () =>
        addBooksPage.pickFiles(AUDIOBOOK_PARTS),
      );
    });

    // The audiobook parser extracts no series, so this form is the only point
    // in the flow that can supply one (#2254).
    await test.step("check the form carries the album as its title", async () => {
      await expect(addBooksPage.review).toBeVisible();
      await expect(form.titleField).not.toHaveValue("");
      await expect(form.seriesField).toHaveValue("");
      await expect(form.bookNumberField).toBeVisible();
      await expect(form.saveButton).toHaveText("Add to library");
    });
  });

  test("refuse a pick that mixes an epub with audiobook parts", async ({
    addBooksPage,
  }) => {
    await test.step("open the add-books page", async () => {
      await addBooksPage.goto();
    });
    // Neither inspect endpoint may be asked about a pick that fits neither, so
    // any request here is a failure rather than a slow assertion.
    const uploadRequests = addBooksPage.recordUploadRequests();

    await test.step("pick an epub with an mp3 part", async () => {
      await addBooksPage.pickFiles([SAMPLE_EPUB, AUDIOBOOK_PARTS[0]!]);
    });

    await test.step("check the status refuses it and nothing was sent", async () => {
      await expect(addBooksPage.statusMessage).toBeVisible();
      await expect(addBooksPage.statusMessage).toHaveClass(/error/);
      await expect(addBooksPage.statusMessage).toContainText("not both");
      await expect(addBooksPage.review).toHaveCount(0);
      expect(uploadRequests).toEqual([]);
    });
  });

  test("name a file neither ingest takes instead of sending it", async ({
    addBooksPage,
  }) => {
    await test.step("open the add-books page", async () => {
      await addBooksPage.goto();
    });
    const uploadRequests = addBooksPage.recordUploadRequests();

    // `accept` only shapes the dialog, and a drop or a lenient browser can
    // still hand the page anything, so the routing refuses it by name.
    await test.step("pick a text file", async () => {
      await addBooksPage.pickFiles({
        name: "notes.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("not a book"),
      });
    });

    await test.step("check the status names the file and nothing was sent", async () => {
      await expect(addBooksPage.statusMessage).toBeVisible();
      await expect(addBooksPage.statusMessage).toHaveClass(/error/);
      await expect(addBooksPage.statusMessage).toContainText("notes.txt");
      await expect(addBooksPage.review).toHaveCount(0);
      expect(uploadRequests).toEqual([]);
    });
  });
});
