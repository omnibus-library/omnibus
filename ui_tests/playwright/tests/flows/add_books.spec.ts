import { resolve } from "node:path";

import { expect, test } from "../fixtures/test";
import { expectMutation } from "../utils/api";
import { expectNavVisible, gotoReady } from "../utils/nav";
import { audiobookFixturesDir, fixturesDir } from "../utils/seed";

// A committed EPUB fixture to feed the file input: two creators, a series, a
// publisher, a date and a cover — every field the review form shows.
const SAMPLE_EPUB = resolve(fixturesDir(), "generated", "beta.epub");
// A public-domain PDF (fetched with the fixtures release) whose Info dict
// carries a title and author for the form to pre-fill.
const SAMPLE_PDF = resolve(fixturesDir(), "public_domain", "flatland.pdf");

// The committed multi-part MP3 audiobook fixture — two chapters that the
// inspect endpoint groups into one book.
const AUDIOBOOK_PARTS = [
  resolve(
    audiobookFixturesDir(),
    "generated",
    "grace_hopper_series",
    "the_compiled_tales",
    "chapter01.mp3",
  ),
  resolve(
    audiobookFixturesDir(),
    "generated",
    "grace_hopper_series",
    "the_compiled_tales",
    "chapter02.mp3",
  ),
];

// A 1×1 PNG — enough for the browser to type it `image/png` and for the
// review form to stage it; nothing here ever sends it.
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

const fileInput = (page: import("@playwright/test").Page) =>
  page.getByTestId("add-books-file-input");
const status = (page: import("@playwright/test").Page) =>
  page.getByTestId("add-books-status");
const review = (page: import("@playwright/test").Page) =>
  page.getByTestId("add-books-review");
const authorChips = (page: import("@playwright/test").Page) =>
  page.locator(".me-chip-item");

/** Every non-inspect request the page sends at the upload routes. */
function recordCommits(page: import("@playwright/test").Page): string[] {
  const sent: string[] = [];
  page.on("request", (req) => {
    const url = req.url();
    if (
      (url.includes("/api/uploads/") && !url.includes("/inspect")) ||
      /\/api\/ebooks\/[^/]+\/cover/.test(url)
    ) {
      sent.push(url);
    }
  });
  return sent;
}

/** Pick the sample EPUB and wait for the review form to land. */
async function stageSampleEpub(page: import("@playwright/test").Page) {
  await expectMutation(
    page,
    { method: "POST", url: "/api/uploads/ebooks/inspect", expectedStatus: 200 },
    async () => fileInput(page).setInputFiles(SAMPLE_EPUB),
  );
  await expect(review(page)).toBeVisible();
}

test("renders the add-books layout", async ({ page }) => {
  await gotoReady(page, "/add-books");

  await expect(
    page.getByRole("heading", { name: "Upload a book" }),
  ).toBeVisible();
  // One picker for every format — there is no ebook/audiobook toggle to click
  // first; the extension of what you pick decides the ingest.
  await expect(fileInput(page)).toBeVisible();
  await expect(fileInput(page)).toHaveAttribute("accept", /\.epub/);
  await expect(fileInput(page)).toHaveAttribute("accept", /\.pdf/);
  await expect(fileInput(page)).toHaveAttribute("accept", /\.m4b/);
  await expect(fileInput(page)).toHaveAttribute("multiple");
  await expect(page.getByTestId("add-books-formats")).toBeVisible();
  await expect(page.getByTestId("add-books-type-ebook")).toHaveCount(0);
  await expect(page.getByTestId("add-books-type-audiobook")).toHaveCount(0);
  // Nothing to review until something is picked.
  await expect(review(page)).toHaveCount(0);
  await expectNavVisible(page);
});

test("opens the full review form from an uploaded EPUB without creating anything", async ({
  page,
}) => {
  await gotoReady(page, "/add-books");
  const sent = recordCommits(page);

  // Selecting a file kicks off the inspect round-trip; the metadata edit
  // form appears over the file's own record.
  await stageSampleEpub(page);

  await expect(page.getByLabel("Title")).toHaveValue("Beta in the Series");
  // beta.epub declares two creators: both become author chips, so the form
  // never under-reports what it will save (#2355).
  await expect(authorChips(page).getByText("Grace Hopper")).toBeVisible();
  await expect(authorChips(page).getByText("Margaret Hamilton")).toBeVisible();
  await expect(page.getByLabel("Publisher")).toHaveValue("Omnibus Test Press");
  await expect(page.getByLabel("Published")).toHaveValue("1969-07-20");
  await expect(page.getByLabel("Series", { exact: true })).toHaveValue(
    "Pioneers",
  );
  await expect(page.getByLabel("Book #")).toHaveValue("1");
  // The file's cover is shown inline — there is no cover route yet.
  await expect(
    page.getByTestId("cover-staged-preview").locator("img"),
  ).toHaveAttribute("src", /^data:image\/webp;base64,/);
  await expect(page.getByTestId("cover-hint")).toHaveText(
    "extracted from file",
  );
  // The primary action is the commit, and it is offered untouched.
  await expect(page.getByTestId("me-save")).toHaveText("Add to library");
  await expect(page.getByTestId("me-save")).toBeEnabled();
  // Reviewing sent nothing beyond the inspect.
  expect(sent).toEqual([]);
});

test("opens the review form from an uploaded PDF", async ({ page }) => {
  await gotoReady(page, "/add-books");

  await expectMutation(
    page,
    { method: "POST", url: "/api/uploads/ebooks/inspect", expectedStatus: 200 },
    async () => fileInput(page).setInputFiles(SAMPLE_PDF),
  );

  await expect(review(page)).toBeVisible();
  // The Info dict fills both fields — a PDF is inspected by the same parser
  // the scan uses, so what the form shows is what the library would index.
  await expect(page.getByLabel("Title")).toHaveValue(
    "Flatland: A Romance of Many Dimensions",
  );
  await expect(
    authorChips(page).getByText("Edwin Abbott Abbott"),
  ).toBeVisible();
});

test("stages a picked cover for the commit instead of writing it", async ({
  page,
}) => {
  await gotoReady(page, "/add-books");
  const sent = recordCommits(page);
  await stageSampleEpub(page);

  await page.getByTestId("cover-upload-input").setInputFiles({
    name: "cover.png",
    mimeType: "image/png",
    buffer: TINY_PNG,
  });

  // The sidebar says the pick goes with the book, and offers the way back.
  await expect(page.getByTestId("cover-hint")).toHaveText(
    "your image · saved with the book",
  );
  await expect(page.getByTestId("me-cover-replaced")).toHaveText(
    "Cover replaced · saved with the book",
  );
  await page.getByTestId("cover-remove-override").click();
  await expect(page.getByTestId("cover-hint")).toHaveText(
    "extracted from file",
  );
  await expect(page.getByTestId("cover-remove-override")).toHaveCount(0);
  // No cover route was written to — there is no book to write to.
  expect(sent).toEqual([]);
});

test("starting over drops the review without sending anything", async ({
  page,
}) => {
  await gotoReady(page, "/add-books");
  const sent = recordCommits(page);
  await stageSampleEpub(page);

  await page.getByTestId("me-discard").click();

  await expect(review(page)).toHaveCount(0);
  await expect(fileInput(page)).toBeVisible();
  expect(sent).toEqual([]);
});

test("surfaces an error when inspect fails", async ({ page }) => {
  await gotoReady(page, "/add-books");

  // Force the inspect call to fail server-side.
  await page.route("**/api/uploads/ebooks/inspect", (route) =>
    route.fulfill({ status: 500, body: "boom" }),
  );

  await expectMutation(
    page,
    { method: "POST", url: "/api/uploads/ebooks/inspect", expectedStatus: 500 },
    async () => fileInput(page).setInputFiles(SAMPLE_EPUB),
  );

  // The status region surfaces the failure, and the review form never appears.
  await expect(status(page)).toBeVisible();
  await expect(status(page)).toHaveClass(/error/);
  await expect(review(page)).toHaveCount(0);
});

test("opens the review form from a multi-part MP3 audiobook", async ({
  page,
}) => {
  await gotoReady(page, "/add-books");

  // Both .mp3 parts in one pick, and the page routes them to the audiobook
  // ingest from the extension alone.
  await expectMutation(
    page,
    {
      method: "POST",
      url: "/api/uploads/audiobooks/inspect",
      expectedStatus: 200,
    },
    async () => fileInput(page).setInputFiles(AUDIOBOOK_PARTS),
  );

  await expect(review(page)).toBeVisible();
  // The title is derived from the shared album tag across the parts.
  await expect(page.getByLabel("Title")).not.toHaveValue("");
  // The audiobook parser extracts no series, which is exactly why the fields
  // have to be offered here (#2254) — this is the only point in the flow that
  // can supply one.
  await expect(page.getByLabel("Series", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Book #")).toBeVisible();
  await expect(page.getByTestId("me-save")).toHaveText("Add to library");
});

test("refuses a pick that mixes an EPUB with audiobook parts", async ({
  page,
}) => {
  await gotoReady(page, "/add-books");

  // Neither inspect endpoint may be asked about a pick that fits neither, so
  // any request here is a failure, not a slow assertion.
  const sent: string[] = [];
  page.on("request", (req) => {
    if (req.url().includes("/api/uploads/")) sent.push(req.url());
  });

  await fileInput(page).setInputFiles([SAMPLE_EPUB, AUDIOBOOK_PARTS[0]!]);

  await expect(status(page)).toBeVisible();
  await expect(status(page)).toHaveClass(/error/);
  await expect(status(page)).toContainText("not both");
  await expect(review(page)).toHaveCount(0);
  expect(sent).toEqual([]);
});

test("names a file neither ingest takes instead of sending it", async ({
  page,
}) => {
  await gotoReady(page, "/add-books");

  const sent: string[] = [];
  page.on("request", (req) => {
    if (req.url().includes("/api/uploads/")) sent.push(req.url());
  });

  // `accept` only shapes the dialog; a drop or a lenient browser can still
  // hand the page anything, so the routing has to refuse it by name.
  await fileInput(page).setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("not a book"),
  });

  await expect(status(page)).toBeVisible();
  await expect(status(page)).toHaveClass(/error/);
  await expect(status(page)).toContainText("notes.txt");
  await expect(review(page)).toHaveCount(0);
  expect(sent).toEqual([]);
});
