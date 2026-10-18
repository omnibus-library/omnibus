import { scan } from "../contracts/scan";
import { search } from "../contracts/search";
import { buildExternalBook, notInLibrary } from "../data/scan";
import { uniqueSuffix } from "../data/unique";
import { FIXTURE_BOOKS } from "../fixtures/epubs";
import { expect, test } from "../fixtures/pageFixtures";
import { failing } from "../utils/api";
import { fetchBookUuidByTitle } from "../utils/ebooks";
import { fixturesDir, seedLibrary } from "../utils/seed";

// Links a copy no rung of the matching ladder can place (#1790). Only the
// lookup is stubbed. TARGET is reserved here, as ISBN stays bound to it.

const TARGET = FIXTURE_BOOKS.find((b) => b.slug === "polyglot-2")!;
const TARGET_QUERY = "Cuentos";
const ISBN = "9781402894626";
const PLACEHOLDER = buildExternalBook({
  isbn13: ISBN,
  title: "Untitled Placeholder Release (Deluxe Limited Edition)",
  authors: ["Unknown Placeholder"],
  year: null,
});

test.describe("check-in link to an existing book", () => {
  test.beforeAll("seed the library", async ({ request }) => {
    await seedLibrary(request, fixturesDir(), FIXTURE_BOOKS.length);
  });

  test("show the link picker layout", async ({
    checkInPage,
    expectMutation,
  }) => {
    const flow = checkInPage.flow;

    await test.step("look up the placeholder isbn", async () => {
      await flow.stubIsbnLookup(notInLibrary(PLACEHOLDER));
      await checkInPage.goto();
      await expectMutation(scan.resolve(ISBN), () => flow.lookUpIsbn(ISBN));
      await expect(flow.chooseScreen).toBeVisible();
    });

    // The chooser's other options would each add a duplicate book.
    await test.step("open the link picker from the chooser", async () => {
      await expect(flow.linkExistingButton).toBeVisible();
      await flow.openLinkPicker();
    });

    await test.step("check the picker is ready to search", async () => {
      await checkInPage.topNav.assertDisplayed();
      await expect(flow.linkScreen).toBeVisible();
      await expect(flow.screenHeading).toHaveText("Which book is this?");
      await expect(flow.libraryQueryField).toBeVisible();
      await expect(flow.searchLibraryButton).toBeDisabled();
      await expect(flow.linkEmptyMessage).toHaveCount(0);
      await expect(flow.linkBackButton).toBeVisible();
    });
  });

  test("link a copy to a library book without adding a book", async ({
    request,
    checkInPage,
    bookDetailPage,
    scanRequests,
    filedCopies,
    expectMutation,
  }) => {
    const flow = checkInPage.flow;
    const uuid = await fetchBookUuidByTitle(request, TARGET.title);
    const note = `Signed paperback ${uniqueSuffix()}`;

    await test.step("look up the placeholder isbn", async () => {
      await flow.stubIsbnLookup(notInLibrary(PLACEHOLDER));
      await checkInPage.goto();
      await expectMutation(scan.resolve(ISBN), () => flow.lookUpIsbn(ISBN));
      await expect(flow.chooseScreen).toBeVisible();
    });

    await test.step("search the library for the book", async () => {
      await flow.openLinkPicker();
      await expect(flow.linkScreen).toBeVisible();
      await expectMutation(search.palette(TARGET_QUERY), () =>
        flow.searchLibrary(TARGET_QUERY),
      );
      await expect(flow.linkResultsList).toContainText(TARGET.title);
      await expect(flow.linkPickButtons).toHaveCount(1);
    });

    // Picking a book opens the ordinary confirm, so the copy uses the same
    // check-in write as any other.
    await test.step("pick it and check in the copy", async () => {
      await flow.pickLinkResult(TARGET.title);
      await expect(flow.confirmScreen).toBeVisible();
      await flow.enterNote(note);
      filedCopies.push({ bookUuid: uuid, note });
      const { response } = await expectMutation(
        scan.checkIn({ uuid, isbn13: ISBN }, note),
        () => flow.checkInCopy(),
      );
      expect(await response.json()).toEqual({ book_uuid: uuid });
    });

    await test.step("check the copy joined the collection", async () => {
      await expect(flow.successScreen).toContainText(
        "In your physical collection",
      );
      await expect(flow.successScreen).toContainText(TARGET.title);
    });

    await test.step("check the book's page shows the copy", async () => {
      await bookDetailPage.goto(uuid);
      await expect(bookDetailPage.physicalPill).toBeVisible();
      await expect(bookDetailPage.physicalCopy.card(note)).toBeVisible();
    });

    // The ISBN now matches the book directly, without asking the providers.
    await test.step("check the isbn now resolves to the book", async () => {
      const rescan = await scanRequests.postResolve(ISBN);
      await expect(rescan).toBeOK();
      expect(await rescan.json()).toMatchObject({
        kind: "already_owned",
        book: { uuid },
      });
    });
  });

  test("stay on the confirm when the linked check-in fails", async ({
    request,
    checkInPage,
    expectMutation,
  }) => {
    const flow = checkInPage.flow;
    const book = {
      uuid: await fetchBookUuidByTitle(request, TARGET.title),
      isbn13: ISBN,
    };

    await test.step("look up the placeholder isbn", async () => {
      await flow.stubIsbnLookup(notInLibrary(PLACEHOLDER));
      await checkInPage.forceServerError(scan.checkIn(book));
      await checkInPage.goto();
      await expectMutation(scan.resolve(ISBN), () => flow.lookUpIsbn(ISBN));
      await expect(flow.chooseScreen).toBeVisible();
    });

    await test.step("pick the library book", async () => {
      await flow.openLinkPicker();
      await expect(flow.linkScreen).toBeVisible();
      await expectMutation(search.palette(TARGET_QUERY), () =>
        flow.searchLibrary(TARGET_QUERY),
      );
      await flow.pickLinkResult(TARGET.title);
      await expect(flow.confirmScreen).toBeVisible();
    });

    await test.step("check in while check-ins fail", async () => {
      await expectMutation(failing(scan.checkIn(book)), () =>
        flow.checkInCopy(),
      );
    });

    // The reader keeps the picked book and can retry.
    await test.step("check the error shows over the confirm", async () => {
      await expect(flow.errorMessage).toBeVisible();
      await expect(flow.confirmScreen).toBeVisible();
    });
  });

  test("go back to the chooser after a search with no match", async ({
    checkInPage,
    expectMutation,
  }) => {
    const flow = checkInPage.flow;
    const query = "zzzz no such book in this library zzzz";

    await test.step("look up the placeholder isbn", async () => {
      await flow.stubIsbnLookup(notInLibrary(PLACEHOLDER));
      await checkInPage.goto();
      await expectMutation(scan.resolve(ISBN), () => flow.lookUpIsbn(ISBN));
      await expect(flow.chooseScreen).toBeVisible();
    });

    await test.step("search the library for nothing", async () => {
      await flow.openLinkPicker();
      await expect(flow.linkScreen).toBeVisible();
      await expectMutation(search.palette(query), () =>
        flow.searchLibrary(query),
      );
    });

    await test.step("check the picker says so", async () => {
      await expect(flow.linkEmptyMessage).toBeVisible();
      await expect(flow.linkResultsList).toHaveCount(0);
    });

    // Back returns to the chooser, which still shows the looked-up book.
    await test.step("go back to the chooser", async () => {
      await flow.backToChooser();
      await expect(flow.chooseScreen).toBeVisible();
      await expect(flow.chooseScreen).toContainText(
        "Untitled Placeholder Release",
      );
    });
  });
});
