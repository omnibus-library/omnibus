import { join } from "node:path";
import type {
  APIRequest,
  APIRequestContext,
  APIResponse,
  Browser,
  Page,
  Request,
  Response,
  ViewportSize,
  WorkerInfo,
} from "@playwright/test";
import { AccountRequests } from "../apiRequests/AccountRequests";
import { AuthRequests } from "../apiRequests/AuthRequests";
import { BookmarksRequests } from "../apiRequests/BookmarksRequests";
import { EbooksRequests } from "../apiRequests/EbooksRequests";
import { GoalsRequests } from "../apiRequests/GoalsRequests";
import { HighlightsRequests } from "../apiRequests/HighlightsRequests";
import { MergeRequests } from "../apiRequests/MergeRequests";
import { OverridesRequests } from "../apiRequests/OverridesRequests";
import { PhysicalRequests } from "../apiRequests/PhysicalRequests";
import { ProgressRequests } from "../apiRequests/ProgressRequests";
import { ReadStatusRequests } from "../apiRequests/ReadStatusRequests";
import { ScanRequests } from "../apiRequests/ScanRequests";
import { ShelvesRequests } from "../apiRequests/ShelvesRequests";
import { UsersRequests } from "../apiRequests/UsersRequests";
import type { SeededBookmark } from "../data/bookmarks";
import type { LibraryBook } from "../data/ebooks";
import {
  buildHighlight,
  type NewHighlight,
  type SeededHighlight,
} from "../data/highlights";
import type { FiledCopy, PhysicalCopy } from "../data/physical";
import type { BookProgress, ProgressRecord } from "../data/progress";
import type { ReadStatus, ReadStatusRecord } from "../data/readStatus";
import {
  buildShelf,
  type NewShelf,
  type ShelfRef,
  wishlistOf,
} from "../data/shelves";
import { buildReader, type Credentials } from "../data/users";
import { AuthorsIndexPage } from "../pages/AuthorsIndexPage";
import { BookDetailPage } from "../pages/BookDetailPage";
import { CheckInPage } from "../pages/CheckInPage";
import { ComicReaderPage } from "../pages/ComicReaderPage";
import { EpubReaderPage } from "../pages/EpubReaderPage";
import { LibraryPage } from "../pages/LibraryPage";
import { ListenPage } from "../pages/ListenPage";
import { LoginPage } from "../pages/LoginPage";
import { PdfReaderPage } from "../pages/PdfReaderPage";
import { SettingsPage } from "../pages/SettingsPage";
import { ShelfPage } from "../pages/ShelfPage";
import { ShelvesIndexPage } from "../pages/ShelvesIndexPage";
import {
  type ExpectMutationOptions,
  expectMutation as expectMutationOn,
} from "../utils/api";
import { withLock } from "../utils/lock";
import { DUAL_FORMAT_BOOK } from "./dual_format";
import {
  test as base,
  expect,
  loadAdminBearerToken,
  newBearerContext,
} from "./test";

/** `expectMutation` from `utils/api`, bound to the test's page. */
export type ExpectMutation = <T>(
  contract: ExpectMutationOptions,
  action: () => Promise<T>,
) => Promise<{ result: T; request: Request; response: Response }>;

/** A plain reader this worker signs up once, for every test that needs one. */
export type ReaderAccount = Credentials & {
  id: number;
  storageStatePath: string;
  bearerToken: string;
};

/** Registers merges so each is undone, newest first, before the lock frees. */
export type MergeLock = {
  undoAfter(mergeLogId: number): void;
  undone(mergeLogId: number): void;
};

type PageWorkerFixtures = {
  readerAccount: ReaderAccount;
  secondReaderAccount: ReaderAccount;
};

type PageFixtures = {
  expectMutation: ExpectMutation;
  libraryPage: LibraryPage;
  bookDetailPage: BookDetailPage;
  checkInPage: CheckInPage;
  epubReaderPage: EpubReaderPage;
  comicReaderPage: ComicReaderPage;
  pdfReaderPage: PdfReaderPage;
  shelfPage: ShelfPage;
  scanRequests: ScanRequests;
  physicalRequests: PhysicalRequests;
  highlightsRequests: HighlightsRequests;
  progressRequests: ProgressRequests;
  readStatusRequests: ReadStatusRequests;
  bookmarksRequests: BookmarksRequests;
  createdBookUuids: Set<string>;
  filedCopies: FiledCopy[];
  seededHighlightIds: Set<number>;
  seededBookmarkIds: Set<number>;
  highlightOn: (
    bookUuid: string,
    overrides?: Partial<NewHighlight>,
  ) => Promise<SeededHighlight>;
  storedPosition: (bookUuid: string) => Promise<ProgressRecord | null>;
  storedReadStatus: (bookUuid: string) => Promise<ReadStatus | null>;
  presetReadStatus: (bookUuid: string, status: ReadStatus) => Promise<void>;
  parkBook: (
    bookUuid: string,
    anchor: string,
    status: ReadStatus,
  ) => Promise<void>;
  adminWishlist: ShelfRef;
  dualFormatUuid: string;
  readerPage: Page;
  readerRequest: APIRequestContext;
  readerShelvesRequests: ShelvesRequests;
  readerAccountRequests: AccountRequests;
  readerLibraryPage: LibraryPage;
  readerBookDetailPage: BookDetailPage;
  readerSettingsPage: SettingsPage;
  readerShelfPage: ShelfPage;
  secondReaderPage: Page;
  secondReaderRequest: APIRequestContext;
  secondReaderSettingsPage: SettingsPage;
  settingsPage: SettingsPage;
  loginPage: LoginPage;
  authorsIndexPage: AuthorsIndexPage;
  listenPage: ListenPage;
  shelvesRequests: ShelvesRequests;
  accountRequests: AccountRequests;
  overridesRequests: OverridesRequests;
  mergeRequests: MergeRequests;
  goalsRequests: GoalsRequests;
  createdShelfIds: Set<number>;
  ownShelf: (
    label: string,
    shelf?: Partial<NewShelf>,
    owner?: "admin" | "reader",
  ) => Promise<ShelfRef>;
  mergeLock: MergeLock;

  // #region batch-A: auth and account settings
  // #endregion batch-A

  // #region batch-B: admin settings
  // #endregion batch-B

  // #region batch-C: book detail
  // #endregion batch-C

  // #region batch-D: book detail writes
  // #endregion batch-D

  // #region batch-E: metadata edit
  // #endregion batch-E

  // #region batch-F: landing and add books
  // #endregion batch-F

  // #region batch-G: shelves
  shelvesIndexPage: ShelvesIndexPage;
  seedResumePoint: (bookUuid: string) => Promise<void>;
  // #endregion batch-G

  // #region batch-H: filters and book-detail shelves
  // #endregion batch-H

  // #region batch-I: search, nav and discovery
  // #endregion batch-I

  // #region batch-J: audio and cross-format
  // #endregion batch-J

  // #region batch-K: stats
  // #endregion batch-K

  // #region batch-L: iOS reader glue
  // #endregion batch-L
};

/** Retries a sign-in the limiter answered 429 until it clears, for up to 70 s. */
async function signInPastLimit(
  attempt: () => Promise<APIResponse>,
): Promise<APIResponse> {
  let response = await attempt();
  await expect
    .poll(
      async () => {
        if (response.status() === 429) response = await attempt();
        return response.status();
      },
      {
        message: "sign-in stays rate limited",
        timeout: 70_000,
        intervals: [1_000, 5_000],
      },
    )
    .not.toBe(429);
  return response;
}

/** Signs up a reader and signs it in for a cookie and a bearer; deletes it after `use`. */
async function withReaderAccount(
  api: APIRequest,
  workerInfo: WorkerInfo,
  use: (account: ReaderAccount) => Promise<void>,
): Promise<void> {
  const options = workerInfo.project.use;
  const admin = await newBearerContext(api, options, loadAdminBearerToken());
  const users = new UsersRequests(admin);
  const reader = buildReader();
  const created = await users.postUser(reader);
  await expect(created, `create ${reader.username}`).toBeOK();
  const { id } = await created.json();

  const session = await newBearerContext(api, options, null);
  const auth = new AuthRequests(session);
  await expect(
    await signInPastLimit(() => auth.postCookieLogin(reader)),
  ).toBeOK();
  const storageStatePath = join(
    workerInfo.project.outputDir,
    ".auth",
    `${reader.username}.json`,
  );
  await session.storageState({ path: storageStatePath });
  const bearer = await signInPastLimit(() => auth.postBearerLogin(reader));
  await expect(bearer).toBeOK();
  const { token } = await bearer.json();
  await session.dispose();

  await use({ ...reader, id, storageStatePath, bearerToken: token });

  await expect(await users.deleteUser(id)).toBeOK();
  await admin.dispose();
}

/** A page in a context of its own signed in as `account`, closed after `use`. */
async function usePageAs(
  browser: Browser,
  account: ReaderAccount,
  viewport: ViewportSize | null,
  use: (page: Page) => Promise<void>,
): Promise<void> {
  const context = await browser.newContext({
    storageState: account.storageStatePath,
    viewport,
  });
  await use(await context.newPage());
  await context.close();
}

/**
 * The suite admin's fixtures: its page and page objects, its API calls and
 * their cleanup, and the worker's reader in a browser context of its own.
 * `readerFixtures.ts` signs the page in as that reader.
 */
export const test = base.extend<PageFixtures, PageWorkerFixtures>({
  // One account per worker rather than per test, because sign-in allows ten
  // calls a minute per IP and a worker runs its tests one at a time.
  readerAccount: [
    async ({ playwright }, use, workerInfo) =>
      withReaderAccount(playwright.request, workerInfo, use),
    { scope: "worker", timeout: 120_000 },
  ],
  secondReaderAccount: [
    async ({ playwright }, use, workerInfo) =>
      withReaderAccount(playwright.request, workerInfo, use),
    { scope: "worker", timeout: 120_000 },
  ],

  expectMutation: async ({ page }, use) => {
    await use((contract, action) => expectMutationOn(page, contract, action));
  },
  libraryPage: async ({ page }, use) => {
    await use(new LibraryPage(page));
  },
  bookDetailPage: async ({ page }, use) => {
    await use(new BookDetailPage(page));
  },
  checkInPage: async ({ page }, use) => {
    await use(new CheckInPage(page));
  },
  epubReaderPage: async ({ page }, use) => {
    await use(new EpubReaderPage(page));
  },
  comicReaderPage: async ({ page }, use) => {
    await use(new ComicReaderPage(page));
  },
  pdfReaderPage: async ({ page }, use) => {
    await use(new PdfReaderPage(page));
  },
  shelfPage: async ({ page }, use) => {
    await use(new ShelfPage(page));
  },

  scanRequests: async ({ request }, use) => {
    await use(new ScanRequests(request));
  },

  physicalRequests: async ({ request }, use) => {
    await use(new PhysicalRequests(request));
  },

  highlightsRequests: async ({ request }, use) => {
    await use(new HighlightsRequests(request));
  },

  progressRequests: async ({ request }, use) => {
    await use(new ProgressRequests(request));
  },

  readStatusRequests: async ({ request }, use) => {
    await use(new ReadStatusRequests(request));
  },

  bookmarksRequests: async ({ request }, use) => {
    await use(new BookmarksRequests(request));
  },

  createdBookUuids: async ({ physicalRequests }, use) => {
    const uuids = new Set<string>();
    await use(uuids);
    for (const uuid of uuids) {
      const deleted = await physicalRequests.deleteBook(uuid);
      await expect(deleted, `delete ${uuid}`).toBeOK();
    }
  },

  filedCopies: async ({ physicalRequests }, use) => {
    const filed: FiledCopy[] = [];
    await use(filed);
    for (const { bookUuid, note } of filed) {
      const listed = await physicalRequests.getCopies(bookUuid);
      await expect(listed).toBeOK();
      const copies: PhysicalCopy[] = await listed.json();
      for (const copy of copies.filter((copy) => copy.note === note)) {
        const deleted = await physicalRequests.deleteCopy(copy.id);
        await expect(deleted, `delete copy ${copy.id}`).toBeOK();
      }
    }
  },

  seededHighlightIds: async ({ highlightsRequests }, use) => {
    const ids = new Set<number>();
    await use(ids);
    for (const id of ids) {
      const deleted = await highlightsRequests.deleteHighlight(id);
      await expect(deleted, `delete highlight ${id}`).toBeOK();
    }
  },

  seededBookmarkIds: async ({ bookmarksRequests }, use) => {
    const ids = new Set<number>();
    await use(ids);
    for (const id of ids) {
      const deleted = await bookmarksRequests.deleteBookmark(id);
      await expect(deleted, `delete bookmark ${id}`).toBeOK();
    }
  },

  highlightOn: async ({ highlightsRequests, seededHighlightIds }, use) => {
    await use(async (bookUuid, overrides) => {
      const highlight = buildHighlight(bookUuid, overrides);
      const created = await highlightsRequests.postHighlight(highlight);
      expect(created.status(), "seed highlight").toBe(200);
      const { id } = await created.json();
      seededHighlightIds.add(id);
      return { ...highlight, id };
    });
  },

  // Null on a failed read, so it stays safe inside `expect.poll`.
  storedPosition: async ({ progressRequests }, use) => {
    await use(async (bookUuid) => {
      const response = await progressRequests.getProgress(bookUuid);
      if (!response.ok()) return null;
      const progress: BookProgress | null = await response.json();
      return progress?.records.find((r) => r.format === "epub") ?? null;
    });
  },

  // Null on a failed read or no row, so it stays safe inside `expect.poll`.
  storedReadStatus: async ({ readStatusRequests }, use) => {
    await use(async (bookUuid) => {
      const response = await readStatusRequests.getReadStatus(bookUuid);
      if (!response.ok()) return null;
      const record: ReadStatusRecord | null = await response.json();
      return record?.status ?? null;
    });
  },

  // Converges by read-then-write, because concurrent writes can hit SQLite's
  // busy timeout while a seed reindex is still writing.
  presetReadStatus: async ({ readStatusRequests, storedReadStatus }, use) => {
    await use(async (bookUuid, status) => {
      await expect
        .poll(
          async () => {
            if ((await storedReadStatus(bookUuid)) === status) return status;
            await readStatusRequests.putReadStatus(bookUuid, status);
            return "pending";
          },
          {
            message: `preset ${bookUuid} to ${status}`,
            timeout: 15_000,
            intervals: [200, 500, 1_000],
          },
        )
        .toBe(status);
    });
  },

  // Parks the read status, the page and no highlights or bookmarks, so a
  // leftover from an earlier run cannot change what a test sees or writes.
  parkBook: async (
    {
      presetReadStatus,
      progressRequests,
      highlightsRequests,
      bookmarksRequests,
    },
    use,
  ) => {
    await use(async (bookUuid, anchor, status) => {
      const listedHighlights = await highlightsRequests.getHighlights(bookUuid);
      await expect(listedHighlights, "list highlights").toBeOK();
      const strayHighlights: SeededHighlight[] = await listedHighlights.json();
      for (const { id } of strayHighlights) {
        const deleted = await highlightsRequests.deleteHighlight(id);
        await expect(deleted, `delete highlight ${id}`).toBeOK();
      }

      const listedBookmarks = await bookmarksRequests.getBookmarks(bookUuid);
      await expect(listedBookmarks, "list bookmarks").toBeOK();
      const strayBookmarks: SeededBookmark[] = await listedBookmarks.json();
      for (const { id } of strayBookmarks) {
        const deleted = await bookmarksRequests.deleteBookmark(id);
        await expect(deleted, `delete bookmark ${id}`).toBeOK();
      }

      await presetReadStatus(bookUuid, status);
      await expect
        .poll(
          async () =>
            (
              await progressRequests.postEpubPosition(bookUuid, anchor)
            ).status(),
          {
            message: "park saved progress",
            timeout: 15_000,
            intervals: [200, 500, 1_000],
          },
        )
        .toBe(200);
    });
  },

  adminWishlist: async ({ request }, use) => {
    const me = await new AuthRequests(request).getMe();
    await expect(me).toBeOK();
    const { id } = await me.json();
    const listed = await new ShelvesRequests(request).getShelves();
    await expect(listed).toBeOK();
    await use(wishlistOf(await listed.json(), id));
  },

  // A combined book count can land before the second scan attaches the other
  // format, so poll until the book lists both an ebook and an audio format.
  dualFormatUuid: async ({ request }, use) => {
    const isEbook = (f: string) => /^(epub|pdf)$/i.test(f);
    const isAudio = (f: string) => /^(mp3|m4b)$/i.test(f);
    const ebooks = new EbooksRequests(request);

    let match: LibraryBook | undefined;
    await expect
      .poll(
        async () => {
          const listed = await ebooks.getEbooks();
          if (listed.status() !== 200) return false;
          const { books }: { books: LibraryBook[] } = await listed.json();
          match = books.find((b) => b.title === DUAL_FORMAT_BOOK.title);
          if (match === undefined) return false;
          return match.formats.some(isEbook) && match.formats.some(isAudio);
        },
        {
          message: `book ${JSON.stringify(DUAL_FORMAT_BOOK.title)} never surfaced with both an ebook and an audio format`,
          timeout: 20_000,
          intervals: [100, 200, 500, 1_000, 2_000],
        },
      )
      .toBe(true);

    if (!match?.unique_identifier) {
      throw new Error(
        `dual-format book ${JSON.stringify(DUAL_FORMAT_BOOK.title)} is missing its uuid`,
      );
    }
    await use(match.unique_identifier);
  },

  readerPage: async ({ browser, readerAccount, viewport }, use) => {
    await usePageAs(browser, readerAccount, viewport, use);
  },

  readerRequest: async (
    { playwright, baseURL, extraHTTPHeaders, readerAccount },
    use,
  ) => {
    const context = await newBearerContext(
      playwright.request,
      { baseURL, extraHTTPHeaders },
      readerAccount.bearerToken,
    );
    await use(context);
    await context.dispose();
  },

  readerShelvesRequests: async ({ readerRequest }, use) => {
    await use(new ShelvesRequests(readerRequest));
  },

  readerAccountRequests: async ({ readerRequest }, use) => {
    await use(new AccountRequests(readerRequest));
  },

  readerLibraryPage: async ({ readerPage }, use) => {
    await use(new LibraryPage(readerPage));
  },
  readerBookDetailPage: async ({ readerPage }, use) => {
    await use(new BookDetailPage(readerPage));
  },
  readerSettingsPage: async ({ readerPage }, use) => {
    await use(new SettingsPage(readerPage));
  },
  readerShelfPage: async ({ readerPage }, use) => {
    await use(new ShelfPage(readerPage));
  },

  secondReaderPage: async ({ browser, secondReaderAccount, viewport }, use) => {
    await usePageAs(browser, secondReaderAccount, viewport, use);
  },

  secondReaderRequest: async (
    { playwright, baseURL, extraHTTPHeaders, secondReaderAccount },
    use,
  ) => {
    const context = await newBearerContext(
      playwright.request,
      { baseURL, extraHTTPHeaders },
      secondReaderAccount.bearerToken,
    );
    await use(context);
    await context.dispose();
  },

  secondReaderSettingsPage: async ({ secondReaderPage }, use) => {
    await use(new SettingsPage(secondReaderPage));
  },

  settingsPage: async ({ page }, use) => {
    await use(new SettingsPage(page));
  },
  loginPage: async ({ page }, use) => {
    await use(new LoginPage(page));
  },
  authorsIndexPage: async ({ page }, use) => {
    await use(new AuthorsIndexPage(page));
  },
  listenPage: async ({ page }, use) => {
    await use(new ListenPage(page));
  },

  shelvesRequests: async ({ request }, use) => {
    await use(new ShelvesRequests(request));
  },
  accountRequests: async ({ request }, use) => {
    await use(new AccountRequests(request));
  },
  overridesRequests: async ({ request }, use) => {
    await use(new OverridesRequests(request));
  },
  mergeRequests: async ({ request }, use) => {
    await use(new MergeRequests(request));
  },
  goalsRequests: async ({ request }, use) => {
    await use(new GoalsRequests(request));
  },

  createdShelfIds: async ({ shelvesRequests }, use) => {
    const ids = new Set<number>();
    await use(ids);
    for (const id of ids) {
      const deleted = await shelvesRequests.deleteShelf(id);
      await expect(deleted, `delete shelf ${id}`).toBeOK();
    }
  },

  ownShelf: async ({ shelvesRequests, readerShelvesRequests }, use) => {
    const made: { id: number; requests: ShelvesRequests }[] = [];
    await use(async (label, shelf, owner = "admin") => {
      const requests =
        owner === "admin" ? shelvesRequests : readerShelvesRequests;
      const req = buildShelf(label, shelf);
      const created = await requests.postShelf(req);
      await expect(created, `create shelf ${req.name}`).toBeOK();
      const { id } = await created.json();
      made.push({ id, requests });
      return { id, name: req.name };
    });
    for (const { id, requests } of made) {
      const deleted = await requests.deleteShelf(id);
      await expect(deleted, `delete shelf ${id}`).toBeOK();
    }
  },

  // Holds the lock from setup to teardown, because a reader takes none and
  // the merged fixture must be restored before the next writer starts.
  mergeLock: async ({ mergeRequests }, use) => {
    const merged = new Set<number>();
    await withLock("audiobook-merge", async () => {
      await use({
        undoAfter: (mergeLogId) => {
          merged.add(mergeLogId);
        },
        undone: (mergeLogId) => {
          merged.delete(mergeLogId);
        },
      });
      for (const mergeLogId of [...merged].reverse()) {
        const undone = await mergeRequests.postUndo(mergeLogId);
        await expect(undone, `undo merge ${mergeLogId}`).toBeOK();
      }
    });
  },

  // #region batch-A: auth and account settings
  // #endregion batch-A

  // #region batch-B: admin settings
  // #endregion batch-B

  // #region batch-C: book detail
  // #endregion batch-C

  // #region batch-D: book detail writes
  // #endregion batch-D

  // #region batch-E: metadata edit
  // #endregion batch-E

  // #region batch-F: landing and add books
  // #endregion batch-F

  // #region batch-G: shelves
  shelvesIndexPage: async ({ page }, use) => {
    await use(new ShelvesIndexPage(page));
  },
  seedResumePoint: async ({ progressRequests }, use) => {
    await use(async (bookUuid) => {
      const saved = await progressRequests.postResumePoint(bookUuid);
      await expect(saved, `seed progress for ${bookUuid}`).toBeOK();
    });
  },
  // #endregion batch-G

  // #region batch-H: filters and book-detail shelves
  // #endregion batch-H

  // #region batch-I: search, nav and discovery
  // #endregion batch-I

  // #region batch-J: audio and cross-format
  // #endregion batch-J

  // #region batch-K: stats
  // #endregion batch-K

  // #region batch-L: iOS reader glue
  // #endregion batch-L
});

export { expect };
