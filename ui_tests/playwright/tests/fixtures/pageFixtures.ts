import { readFileSync, rmSync } from "node:fs";
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
import { STORAGE_STATE_PATH } from "../../globalSetup";
import { AccountRequests } from "../apiRequests/AccountRequests";
import { AudiobooksRequests } from "../apiRequests/AudiobooksRequests";
import { AuthorsRequests } from "../apiRequests/AuthorsRequests";
import { AuthRequests } from "../apiRequests/AuthRequests";
import { BookmarksRequests } from "../apiRequests/BookmarksRequests";
import { BookRatingRequests } from "../apiRequests/BookRatingRequests";
import { CrossFormatRequests } from "../apiRequests/CrossFormatRequests";
import { EbooksRequests } from "../apiRequests/EbooksRequests";
import { GoalsRequests } from "../apiRequests/GoalsRequests";
import { HighlightsRequests } from "../apiRequests/HighlightsRequests";
import { JournalsRequests } from "../apiRequests/JournalsRequests";
import { LogViewerRequests } from "../apiRequests/LogViewerRequests";
import { McpRequests } from "../apiRequests/McpRequests";
import { MergeRequests } from "../apiRequests/MergeRequests";
import { MetadataKeysRequests } from "../apiRequests/MetadataKeysRequests";
import { OverridesRequests } from "../apiRequests/OverridesRequests";
import { PhysicalRequests } from "../apiRequests/PhysicalRequests";
import { ProgressRequests } from "../apiRequests/ProgressRequests";
import { ReadStatusRequests } from "../apiRequests/ReadStatusRequests";
import { ScanRequests } from "../apiRequests/ScanRequests";
import { ShelvesRequests } from "../apiRequests/ShelvesRequests";
import { ThumbsRequests } from "../apiRequests/ThumbsRequests";
import { UploadsRequests } from "../apiRequests/UploadsRequests";
import { UsersRequests } from "../apiRequests/UsersRequests";
import { BookMetaRowsComponent } from "../components/BookMetaRowsComponent";
import { PreHydrationComponent } from "../components/PreHydrationComponent";
import type {
  CreatedApiToken,
  CreatedKoboDevice,
  SignedInSession,
} from "../data/account";
import type { IndexedBook } from "../data/authors";
import { type BookRecord, isAudioFormat } from "../data/bookDetail";
import type { SeededBookmark } from "../data/bookmarks";
import type { LibraryBook, UploadedEbook } from "../data/ebooks";
import {
  buildHighlight,
  type NewHighlight,
  type SeededHighlight,
} from "../data/highlights";
import type { JournalEntryRef, JournalStatus } from "../data/journals";
import {
  bookBySlug,
  FILTER_SHELF_SLUGS,
  type FilterShelf,
} from "../data/libraryFilters";
import type { MetadataProvider } from "../data/metadataKeys";
import type { FiledCopy, PhysicalCopy } from "../data/physical";
import {
  type BookProgress,
  EventClock,
  type ProgressRecord,
} from "../data/progress";
import type { ReadStatus, ReadStatusRecord } from "../data/readStatus";
import { buildRecentPoint, type RecentBook } from "../data/recentProgress";
import {
  buildShelf,
  type NewShelf,
  type ShelfRef,
  wishlistOf,
} from "../data/shelves";
import { buildReader, type Credentials, type SeededUser } from "../data/users";
import { AddBooksPage } from "../pages/AddBooksPage";
import { AdminHealthPage } from "../pages/AdminHealthPage";
import { AuthorPage } from "../pages/AuthorPage";
import { AuthorsIndexPage } from "../pages/AuthorsIndexPage";
import { BookDetailPage } from "../pages/BookDetailPage";
import { CheckInPage } from "../pages/CheckInPage";
import { CleanupReviewPage } from "../pages/CleanupReviewPage";
import { ComicReaderPage } from "../pages/ComicReaderPage";
import { EpubReaderPage } from "../pages/EpubReaderPage";
import { GenreSearchPage } from "../pages/GenreSearchPage";
import { LibraryPage } from "../pages/LibraryPage";
import { ListenPage } from "../pages/ListenPage";
import { LoginPage } from "../pages/LoginPage";
import { MetadataEditPage } from "../pages/MetadataEditPage";
import { NotFoundPage } from "../pages/NotFoundPage";
import { PdfReaderPage } from "../pages/PdfReaderPage";
import { RegisterPage } from "../pages/RegisterPage";
import { SearchResultsPage } from "../pages/SearchResultsPage";
import { SeriesIndexPage } from "../pages/SeriesIndexPage";
import { SeriesPage } from "../pages/SeriesPage";
import { SettingsPage } from "../pages/SettingsPage";
import { ShelfPage } from "../pages/ShelfPage";
import { ShelvesIndexPage } from "../pages/ShelvesIndexPage";
import {
  type ExpectMutationOptions,
  expectMutation as expectMutationOn,
} from "../utils/api";
import { fetchBookUuidByTitle } from "../utils/ebooks";
import { withLock } from "../utils/lock";
import { fixturesDir } from "../utils/seed";
import { MERGE_PRIMARY, MERGE_SECONDARY } from "./audiobooks";
import { DUAL_FORMAT_BOOK, RESUME_PROMPT_BOOK } from "./dual_format";
import { FIXTURE_BOOKS } from "./epubs";
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
  registerPage: RegisterPage;
  mcpRequests: McpRequests;
  readerExpectMutation: ExpectMutation;
  adminSession: SignedInSession;
  presetGoals: (goals?: { books?: number; pages?: number }) => Promise<void>;
  presetShareStats: (enabled: boolean) => Promise<void>;
  presetDisplayName: (displayName: string | null) => Promise<void>;
  presetKindleEmail: (email: string | null) => Promise<void>;
  presetMcpEndpoint: (enabled: boolean) => Promise<void>;
  presetReaderHiddenFormats: (formats: string[]) => Promise<void>;
  createdKoboDeviceIds: Set<number>;
  ownKoboDevice: (name: string) => Promise<number>;
  createdApiTokenIds: Set<number>;
  ownApiToken: (name: string) => Promise<number>;
  // #endregion batch-A

  // #region batch-B: admin settings
  usersRequests: UsersRequests;
  createdUserIds: Set<number>;
  seedUser: () => Promise<SeededUser>;
  anonymousRequest: APIRequestContext;
  anonymousLogViewerRequests: LogViewerRequests;
  metadataKeysRequests: MetadataKeysRequests;
  savedMetadataKeys: Set<MetadataProvider>;
  cleanupReviewPage: CleanupReviewPage;
  adminHealthPage: AdminHealthPage;
  // #endregion batch-B

  // #region batch-C: book detail
  bookRatingRequests: BookRatingRequests;
  ebooksRequests: EbooksRequests;
  ratedBookUuids: Set<string>;
  revertedOverrides: Set<string>;
  setScrollStops: (enabled: boolean) => Promise<void>;
  startReadStatusAt: (bookUuid: string, status: ReadStatus) => Promise<void>;
  clearHighlights: (bookUuid: string) => Promise<void>;
  mergedMp3Book: string;
  // #endregion batch-C

  // #region batch-D: book detail writes
  journalsRequests: JournalsRequests;
  uploadsRequests: UploadsRequests;
  createdJournalIds: Set<number>;
  journalEntryOn: (
    bookUuid: string,
    body: string,
    status?: JournalStatus,
  ) => Promise<JournalEntryRef>;
  uploadedEbook: UploadedEbook;
  bookExists: (bookUuid: string) => Promise<boolean>;
  // #endregion batch-D

  // #region batch-E: metadata edit
  metadataEditPage: MetadataEditPage;
  genreSearchPage: GenreSearchPage;
  overriddenBookUuids: Set<string>;
  assignGenres: (bookUuid: string, genres: string[]) => Promise<void>;
  // #endregion batch-E

  // #region batch-F: landing and add books
  addBooksPage: AddBooksPage;
  notFoundPage: NotFoundPage;
  preHydration: PreHydrationComponent;
  bookMetaRows: BookMetaRowsComponent;
  thumbsRequests: ThumbsRequests;
  revertOverridesOf: (...titles: string[]) => Promise<void>;
  presetStackSeries: (enabled: boolean) => Promise<void>;
  // #endregion batch-F

  // #region batch-G: shelves
  shelvesIndexPage: ShelvesIndexPage;
  seedResumePoint: (bookUuid: string) => Promise<void>;
  // #endregion batch-G

  // #region batch-H: filters and book-detail shelves
  filterShelf: FilterShelf;
  changedReadStatusUuids: Set<string>;
  scheduleScrollStopsReset: () => void;
  // #endregion batch-H

  // #region batch-I: search, nav and discovery
  searchResultsPage: SearchResultsPage;
  authorPage: AuthorPage;
  seriesPage: SeriesPage;
  seriesIndexPage: SeriesIndexPage;
  authorsRequests: AuthorsRequests;
  indexedBooks: () => Promise<IndexedBook[]>;
  authorId: (name: string) => Promise<number>;
  seriesId: (name: string) => Promise<number>;
  linkedAuthorNames: () => Promise<string[]>;
  deletedAuthors: Set<string>;
  uploadAuthorPhoto: (authorId: number) => Promise<void>;
  recentBook: (
    format: "epub" | "audio",
    bookFileId?: number,
  ) => Promise<RecentBook>;
  // #endregion batch-I

  // #region batch-J: audio and cross-format
  audiobooksRequests: AudiobooksRequests;
  crossFormatRequests: CrossFormatRequests;
  signedInUserId: number;
  audioFileId: (bookUuid: string) => Promise<number>;
  resumePromptUuid: string;
  linkedBookUuids: Set<string>;
  eventClock: EventClock;
  newestStoredClock: (bookUuid: string) => Promise<number>;
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
  registerPage: async ({ page }, use) => {
    await use(new RegisterPage(page));
  },
  mcpRequests: async ({ request }, use) => {
    await use(new McpRequests(request));
  },

  // The reader's page is not `page`, so its mutations need their own waiter.
  readerExpectMutation: async ({ readerPage }, use) => {
    await use((contract, action) =>
      expectMutationOn(readerPage, contract, action),
    );
  },

  adminSession: async ({ request }, use) => {
    const me = await new AuthRequests(request).getMe();
    await expect(me).toBeOK();
    const stored: { cookies: SignedInSession["cookies"] } = JSON.parse(
      readFileSync(STORAGE_STATE_PATH, "utf8"),
    );
    await use({ user: await me.json(), cookies: stored.cookies });
  },

  // The goal fixtures start from no goals and end there, because a stats spec
  // writes the same three rows on this admin.
  presetGoals: async ({ goalsRequests }, use) => {
    const clear = async () => {
      for (const cleared of await goalsRequests.clearAll()) {
        await expect(cleared, "clear the reading goals").toBeOK();
      }
    };
    await use(async ({ books, pages } = {}) => {
      await clear();
      if (books !== undefined) {
        const set = await goalsRequests.putAnnualGoal({ target: books });
        await expect(set, `set the annual goal to ${books}`).toBeOK();
      }
      if (pages !== undefined) {
        const set = await goalsRequests.putDailyGoals({
          kind: "pages",
          target: pages,
        });
        await expect(set, `set the daily pages goal to ${pages}`).toBeOK();
      }
    });
    await clear();
  },

  // Sharing is on for every other spec, so that is where a test leaves it.
  presetShareStats: async ({ accountRequests }, use) => {
    const set = async (enabled: boolean) => {
      const saved = await accountRequests.postShareStats(enabled);
      await expect(saved, `set share stats to ${enabled}`).toBeOK();
    };
    await use(set);
    await set(true);
  },

  presetDisplayName: async ({ accountRequests }, use) => {
    const set = async (displayName: string | null) => {
      const saved = await accountRequests.postProfile(displayName);
      await expect(saved, `set the display name to ${displayName}`).toBeOK();
    };
    await use(set);
    await set(null);
  },

  presetKindleEmail: async ({ accountRequests }, use) => {
    const set = async (email: string | null) => {
      const saved = await accountRequests.postKindleEmail(email);
      await expect(saved, `set the Kindle email to ${email}`).toBeOK();
    };
    await use(set);
    await set(null);
  },

  // The switch is instance-wide and a reader takes no lock, so the lock keeps
  // two writers from flipping it under each other.
  presetMcpEndpoint: async ({ mcpRequests }, use) => {
    const set = async (enabled: boolean) => {
      const saved = await mcpRequests.postMcp(enabled);
      await expect(saved, `set the MCP endpoint to ${enabled}`).toBeOK();
    };
    await withLock("mcp-endpoint", async () => {
      await use(set);
      await set(false);
    });
  },

  presetReaderHiddenFormats: async ({ readerAccountRequests }, use) => {
    const set = async (formats: string[]) => {
      const saved = await readerAccountRequests.postHiddenFormats(formats);
      await expect(saved, `hide formats [${formats}]`).toBeOK();
    };
    await use(set);
    await set([]);
  },

  createdKoboDeviceIds: async ({ accountRequests }, use) => {
    const ids = new Set<number>();
    await use(ids);
    for (const id of ids) {
      const revoked = await accountRequests.postKoboDeviceRevoke(id);
      await expect(revoked, `revoke Kobo device ${id}`).toBeOK();
    }
  },

  ownKoboDevice: async ({ accountRequests, createdKoboDeviceIds }, use) => {
    await use(async (name) => {
      const created = await accountRequests.postKoboDevice(name);
      await expect(created, `add Kobo device ${name}`).toBeOK();
      const { id }: CreatedKoboDevice = await created.json();
      createdKoboDeviceIds.add(id);
      return id;
    });
  },

  createdApiTokenIds: async ({ accountRequests }, use) => {
    const ids = new Set<number>();
    await use(ids);
    for (const id of ids) {
      const revoked = await accountRequests.postApiTokenRevoke(id);
      await expect(revoked, `revoke API token ${id}`).toBeOK();
    }
  },

  ownApiToken: async ({ accountRequests, createdApiTokenIds }, use) => {
    await use(async (name) => {
      const created = await accountRequests.postApiToken(name);
      await expect(created, `create API token ${name}`).toBeOK();
      const { token }: CreatedApiToken = await created.json();
      createdApiTokenIds.add(token.id);
      return token.id;
    });
  },
  // #endregion batch-A

  // #region batch-B: admin settings
  usersRequests: async ({ request }, use) => {
    await use(new UsersRequests(request));
  },

  createdUserIds: async ({ usersRequests }, use) => {
    const ids = new Set<number>();
    await use(ids);
    for (const id of ids) {
      const deleted = await usersRequests.deleteUser(id);
      await expect(deleted, `delete user ${id}`).toBeOK();
    }
  },

  seedUser: async ({ usersRequests, createdUserIds }, use) => {
    await use(async () => {
      const user = buildReader();
      const created = await usersRequests.postUser(user);
      await expect(created, `create ${user.username}`).toBeOK();
      const { id } = await created.json();
      createdUserIds.add(id);
      return { ...user, id };
    });
  },

  anonymousRequest: async ({ playwright, baseURL, extraHTTPHeaders }, use) => {
    const context = await newBearerContext(
      playwright.request,
      { baseURL, extraHTTPHeaders },
      null,
    );
    await use(context);
    await context.dispose();
  },

  anonymousLogViewerRequests: async ({ anonymousRequest }, use) => {
    await use(new LogViewerRequests(anonymousRequest));
  },

  metadataKeysRequests: async ({ request }, use) => {
    await use(new MetadataKeysRequests(request));
  },

  savedMetadataKeys: async ({ metadataKeysRequests }, use) => {
    const providers = new Set<MetadataProvider>();
    await use(providers);
    for (const provider of providers) {
      const cleared = await metadataKeysRequests.postKey(provider, null);
      await expect(cleared, `clear ${provider} key`).toBeOK();
    }
  },

  cleanupReviewPage: async ({ page }, use) => {
    await use(new CleanupReviewPage(page));
  },
  adminHealthPage: async ({ page }, use) => {
    await use(new AdminHealthPage(page));
  },
  // #endregion batch-B

  // #region batch-C: book detail
  bookRatingRequests: async ({ request }, use) => {
    await use(new BookRatingRequests(request));
  },
  ebooksRequests: async ({ request }, use) => {
    await use(new EbooksRequests(request));
  },

  ratedBookUuids: async ({ bookRatingRequests }, use) => {
    const uuids = new Set<string>();
    await use(uuids);
    for (const uuid of uuids) {
      const cleared = await bookRatingRequests.deleteRating(uuid);
      await expect(cleared, `clear the rating on ${uuid}`).toBeOK();
    }
  },

  revertedOverrides: async ({ overridesRequests }, use) => {
    const uuids = new Set<string>();
    await use(uuids);
    for (const uuid of uuids) {
      const reverted = await overridesRequests.deleteOverrides(uuid);
      await expect(reverted, `revert the overrides on ${uuid}`).toBeOK();
    }
  },

  // Turns the switch back off, because every other detail test reads the flow.
  setScrollStops: async ({ accountRequests }, use) => {
    let changed = false;
    await use(async (enabled) => {
      changed = true;
      const saved = await accountRequests.postScrollStops(enabled);
      await expect(saved, `set scroll stops to ${enabled}`).toBeOK();
    });
    if (changed) {
      const saved = await accountRequests.postScrollStops(false);
      await expect(saved, "turn scroll stops off").toBeOK();
    }
  },

  // Sets the status now and puts the book back to unread after the test.
  startReadStatusAt: async ({ presetReadStatus }, use) => {
    const started = new Set<string>();
    await use(async (bookUuid, status) => {
      started.add(bookUuid);
      await presetReadStatus(bookUuid, status);
    });
    for (const uuid of started) await presetReadStatus(uuid, "unread");
  },

  clearHighlights: async ({ highlightsRequests }, use) => {
    await use(async (bookUuid) => {
      const listed = await highlightsRequests.getHighlights(bookUuid);
      await expect(listed, "list highlights").toBeOK();
      const stray: SeededHighlight[] = await listed.json();
      for (const { id } of stray) {
        const deleted = await highlightsRequests.deleteHighlight(id);
        await expect(deleted, `delete highlight ${id}`).toBeOK();
      }
    });
  },

  // Merging the reserved MP3 pair gives its primary two audio files, the
  // scenario the Listen file picker is for; the lock fixture undoes the merge.
  mergedMp3Book: async (
    { request, mergeRequests, mergeLock, ebooksRequests },
    use,
  ) => {
    const primaryUuid = await fetchBookUuidByTitle(
      request,
      MERGE_PRIMARY.title,
    );
    const secondaryUuid = await fetchBookUuidByTitle(
      request,
      MERGE_SECONDARY.title,
    );
    const merged = await mergeRequests.postMerge(secondaryUuid, primaryUuid);
    await expect(merged, "merge the reserved mp3 pair").toBeOK();
    const { merge_log_id: mergeLogId } = await merged.json();
    mergeLock.undoAfter(mergeLogId);

    const detail = await ebooksRequests.getEbook(primaryUuid);
    await expect(detail, "read the merged book").toBeOK();
    const { book_files: files }: BookRecord = await detail.json();
    expect(
      files.filter((file) => isAudioFormat(file.format)),
      "two audio files after the merge",
    ).toHaveLength(2);
    await use(primaryUuid);
  },
  // #endregion batch-C

  // #region batch-D: book detail writes
  journalsRequests: async ({ request }, use) => {
    await use(new JournalsRequests(request));
  },
  uploadsRequests: async ({ request }, use) => {
    await use(new UploadsRequests(request));
  },

  createdJournalIds: async ({ journalsRequests }, use) => {
    const ids = new Set<number>();
    await use(ids);
    for (const id of ids) {
      const deleted = await journalsRequests.deleteJournal(id);
      await expect(deleted, `delete journal entry ${id}`).toBeOK();
    }
  },

  journalEntryOn: async ({ journalsRequests, createdJournalIds }, use) => {
    await use(async (bookUuid, body, status = "published") => {
      const created = await journalsRequests.postJournal(
        bookUuid,
        body,
        status,
      );
      await expect(created, "seed journal entry").toBeOK();
      const entry: JournalEntryRef = await created.json();
      createdJournalIds.add(entry.id);
      return entry;
    });
  },

  // Removes the folder after a failure too, so no upload outlives the run
  // inside the committed fixtures tree.
  uploadedEbook: async ({ uploadsRequests }, use) => {
    const folder = join(fixturesDir(), "delete-spec");
    const uploaded = await uploadsRequests.postEbook({
      fileName: "deletable.epub",
      epub: readFileSync(join(fixturesDir(), "generated", "alpha.epub")),
      title: "Deletable Test Volume",
      author: "Delete Spec",
    });
    expect(uploaded.status(), "upload the deletable ebook").toBe(201);
    const { uuid }: { uuid: string } = await uploaded.json();
    await use({ uuid, folder });
    rmSync(folder, { recursive: true, force: true });
  },

  bookExists: async ({ request }, use) => {
    const ebooks = new EbooksRequests(request);
    await use(async (bookUuid) => {
      const detail = await ebooks.postEbookDetail(bookUuid);
      if (detail.status() !== 200) return false;
      return (await detail.json()) !== null;
    });
  },
  // #endregion batch-D

  // #region batch-E: metadata edit
  metadataEditPage: async ({ page }, use) => {
    await use(new MetadataEditPage(page));
  },
  genreSearchPage: async ({ page }, use) => {
    await use(new GenreSearchPage(page));
  },

  // Drops what a test left on the books it registers, covers included, so the
  // next test starts from the scanned values.
  overriddenBookUuids: async ({ overridesRequests }, use) => {
    const uuids = new Set<string>();
    await use(uuids);
    for (const uuid of uuids) {
      const reverted = await overridesRequests.deleteOverrides(uuid);
      await expect(reverted, `revert overrides on ${uuid}`).toBeOK();
    }
  },

  assignGenres: async ({ overridesRequests, overriddenBookUuids }, use) => {
    await use(async (bookUuid, genres) => {
      const assigned = await overridesRequests.postOverrides(bookUuid, {
        genres,
      });
      await expect(assigned, "assign genres").toBeOK();
      overriddenBookUuids.add(bookUuid);
    });
  },
  // #endregion batch-E

  // #region batch-F: landing and add books
  addBooksPage: async ({ page }, use) => {
    await use(new AddBooksPage(page));
  },
  notFoundPage: async ({ page }, use) => {
    await use(new NotFoundPage(page));
  },
  preHydration: async ({ page }, use) => {
    await use(new PreHydrationComponent(page));
  },
  bookMetaRows: async ({ page }, use) => {
    await use(new BookMetaRowsComponent(page));
  },
  thumbsRequests: async ({ request }, use) => {
    await use(new ThumbsRequests(request));
  },

  // Registered before the edit, so the revert runs even when the edit fails.
  revertOverridesOf: async ({ request, overridesRequests }, use) => {
    const uuids = new Set<string>();
    await use(async (...titles) => {
      for (const title of titles) {
        uuids.add(await fetchBookUuidByTitle(request, title));
      }
    });
    for (const uuid of uuids) {
      const reverted = await overridesRequests.deleteOverrides(uuid);
      await expect(reverted, `revert overrides on ${uuid}`).toBeOK();
    }
  },

  // The reader's preference outlives the test, so it goes back to off after.
  presetStackSeries: async ({ readerAccountRequests }, use) => {
    const save = async (enabled: boolean) => {
      const saved = await readerAccountRequests.postStackSeries(enabled);
      await expect(saved, `save stack series ${enabled}`).toBeOK();
    };
    await use(save);
    await save(false);
  },
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
  // The reader owns it, because a shelf on the admin would move every other
  // spec's shelf counts.
  filterShelf: async ({ request, ownShelf }, use) => {
    const uuids = new Map<string, string>();
    for (const slug of FILTER_SHELF_SLUGS) {
      uuids.set(
        slug,
        await fetchBookUuidByTitle(request, bookBySlug(slug).title),
      );
    }
    const shelf = await ownShelf(
      "E2E Library Filters",
      { book_uuids: [...uuids.values()] },
      "reader",
    );
    await use({
      ...shelf,
      memberUuid: (slug) => {
        const uuid = uuids.get(slug);
        if (!uuid) throw new Error(`${slug} is not on the filter shelf`);
        return uuid;
      },
    });
  },

  changedReadStatusUuids: async ({ readStatusRequests }, use) => {
    const uuids = new Set<string>();
    await use(uuids);
    for (const uuid of uuids) {
      const reset = await readStatusRequests.putReadStatus(uuid, "unread");
      await expect(reset, `reset read status of ${uuid}`).toBeOK();
    }
  },

  // The reader starts every test with scroll stops off, so a test that turns
  // them on schedules this to put them back.
  scheduleScrollStopsReset: async ({ readerAccountRequests }, use) => {
    let scheduled = false;
    await use(() => {
      scheduled = true;
    });
    if (!scheduled) return;
    const off = await readerAccountRequests.postScrollStops(false);
    await expect(off, "turn the reader's scroll stops off").toBeOK();
  },
  // #endregion batch-H

  // #region batch-I: search, nav and discovery
  searchResultsPage: async ({ page }, use) => {
    await use(new SearchResultsPage(page));
  },
  authorPage: async ({ page }, use) => {
    await use(new AuthorPage(page));
  },
  seriesPage: async ({ page }, use) => {
    await use(new SeriesPage(page));
  },
  seriesIndexPage: async ({ page }, use) => {
    await use(new SeriesIndexPage(page));
  },
  authorsRequests: async ({ request }, use) => {
    await use(new AuthorsRequests(request));
  },

  indexedBooks: async ({ request }, use) => {
    const ebooks = new EbooksRequests(request);
    await use(async () => {
      const listed = await ebooks.getEbooks();
      expect(listed.status(), "GET /api/rpc/ebooks").toBe(200);
      const { books }: { books: IndexedBook[] } = await listed.json();
      return books;
    });
  },

  authorId: async ({ indexedBooks }, use) => {
    await use(async (name) => {
      for (const book of await indexedBooks()) {
        const match = book.creators.find((creator) => creator.name === name);
        if (match?.id) return match.id;
      }
      throw new Error(`no indexed author named ${JSON.stringify(name)}`);
    });
  },

  seriesId: async ({ indexedBooks }, use) => {
    await use(async (name) => {
      const books = await indexedBooks();
      const match = books.find(
        (book) => book.series === name && book.series_id != null,
      );
      if (!match?.series_id) {
        throw new Error(`no indexed series named ${JSON.stringify(name)}`);
      }
      return match.series_id;
    });
  },

  linkedAuthorNames: async ({ indexedBooks }, use) => {
    await use(async () =>
      (await indexedBooks()).flatMap((book) =>
        book.creators.map((creator) => creator.name),
      ),
    );
  },

  // A delete blocklists the name for good and the indexer will not re-read an
  // unchanged EPUB, so an override on each book is what puts the author back.
  deletedAuthors: async (
    { request, overridesRequests, linkedAuthorNames },
    use,
  ) => {
    const names = new Set<string>();
    await use(names);
    for (const name of names) {
      const affected = FIXTURE_BOOKS.filter((book) =>
        book.authors.includes(name),
      );
      expect(
        affected.length,
        `no fixture book lists ${JSON.stringify(name)}`,
      ).toBeGreaterThan(0);
      for (const book of affected) {
        const uuid = await fetchBookUuidByTitle(request, book.title);
        const restored = await overridesRequests.postOverrides(uuid, {
          creators: book.authors.map((author) => ({
            name: author,
            role: null,
            file_as: null,
          })),
        });
        await expect(restored, `restore the authors of ${book.title}`).toBeOK();
      }
      await expect
        .poll(async () => (await linkedAuthorNames()).includes(name), {
          message: `author ${JSON.stringify(name)} should be restored via override`,
          timeout: 10_000,
          intervals: [100, 200, 500, 1_000],
        })
        .toBe(true);
    }
  },

  uploadAuthorPhoto: async ({ authorsRequests }, use) => {
    const uploaded: number[] = [];
    await use(async (authorId) => {
      const put = await authorsRequests.putPhoto(authorId);
      expect(put.status(), `upload a photo for author ${authorId}`).toBe(204);
      uploaded.push(authorId);
    });
    for (const authorId of uploaded) {
      const deleted = await authorsRequests.deletePhoto(authorId);
      await expect(deleted, `delete the photo of author ${authorId}`).toBeOK();
    }
  },

  recentBook: async ({ request }, use) => {
    const ebooks = new EbooksRequests(request);
    await use(async (format, bookFileId) => {
      const target = FIXTURE_BOOKS[1]!;
      const uuid = await fetchBookUuidByTitle(request, target.title);
      const listed = await ebooks.getEbooks();
      expect(listed.status(), "GET /api/rpc/ebooks").toBe(200);
      const { books }: { books: Record<string, unknown>[] } =
        await listed.json();
      const book = books.find(
        (candidate) => candidate.unique_identifier === uuid,
      );
      if (!book) {
        throw new Error(
          `book ${JSON.stringify(target.title)} disappeared after lookup`,
        );
      }
      const point = buildRecentPoint(uuid, book, format, bookFileId ?? null);
      return { uuid, title: target.title, point };
    });
  },
  // #endregion batch-I

  // #region batch-J: audio and cross-format
  audiobooksRequests: async ({ request }, use) => {
    await use(new AudiobooksRequests(request));
  },
  crossFormatRequests: async ({ request }, use) => {
    await use(new CrossFormatRequests(request));
  },

  signedInUserId: async ({ request }, use) => {
    const me = await new AuthRequests(request).getMe();
    await expect(me).toBeOK();
    const { id } = await me.json();
    await use(id);
  },

  // Every audio progress save names the file the player loaded (#1888).
  audioFileId: async ({ audiobooksRequests }, use) => {
    await use(async (bookUuid) => {
      const detail = await audiobooksRequests.getBookDetail(bookUuid);
      await expect(detail, `read ${bookUuid}`).toBeOK();
      const { book_files }: { book_files: { id: number; format: string }[] } =
        await detail.json();
      const audio = book_files.find((file) =>
        /^(mp3|m4b|m4a)$/i.test(file.format),
      );
      if (!audio) throw new Error(`book ${bookUuid} has no audio file`);
      return audio.id;
    });
  },

  // The reserved pair's two scans can land apart, so poll until it lists both
  // an ebook and an audio format.
  resumePromptUuid: async ({ request }, use) => {
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
          match = books.find((b) => b.title === RESUME_PROMPT_BOOK.title);
          if (match === undefined) return false;
          return match.formats.some(isEbook) && match.formats.some(isAudio);
        },
        {
          message: `book ${JSON.stringify(RESUME_PROMPT_BOOK.title)} never surfaced with both an ebook and an audio format`,
          timeout: 45_000,
          intervals: [100, 200, 500, 1_000, 2_000],
        },
      )
      .toBe(true);

    if (!match?.unique_identifier) {
      throw new Error(
        `resume-prompt book ${JSON.stringify(RESUME_PROMPT_BOOK.title)} is missing its uuid`,
      );
    }
    await use(match.unique_identifier);
  },

  linkedBookUuids: async ({ crossFormatRequests }, use) => {
    const uuids = new Set<string>();
    await use(uuids);
    for (const uuid of uuids) {
      const unlinked = await crossFormatRequests.postUnlink(uuid);
      await expect(unlinked, `unlink ${uuid}`).toBeOK();
    }
  },

  // biome-ignore lint/correctness/noEmptyPattern: Playwright reads a fixture's dependencies from this pattern.
  eventClock: async ({}, use) => {
    await use(new EventClock());
  },

  // The newest `client_updated_at` among a book's stored positions, or 0.
  newestStoredClock: async ({ progressRequests }, use) => {
    await use(async (bookUuid) => {
      let newest = 0;
      for (const format of ["epub", "audio"] as const) {
        const stored = await progressRequests.postProgressGet(bookUuid, format);
        if (stored.status() !== 200) continue;
        const record: { client_updated_at: number | null } | null =
          await stored.json();
        newest = Math.max(newest, record?.client_updated_at ?? 0);
      }
      return newest;
    });
  },
  // #endregion batch-J

  // #region batch-K: stats
  // #endregion batch-K

  // #region batch-L: iOS reader glue
  // #endregion batch-L
});

export { expect };
