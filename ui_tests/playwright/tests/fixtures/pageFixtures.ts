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
import { SettingsRequests } from "../apiRequests/SettingsRequests";
import { ShelvesRequests } from "../apiRequests/ShelvesRequests";
import { StatsRequests } from "../apiRequests/StatsRequests";
import { ThumbsRequests } from "../apiRequests/ThumbsRequests";
import { UploadsRequests } from "../apiRequests/UploadsRequests";
import { UsersRequests } from "../apiRequests/UsersRequests";
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
import type { LibrarySettings, ServerLibrary } from "../data/settings";
import {
  buildShelf,
  type NewShelf,
  type ShelfRef,
  wishlistOf,
} from "../data/shelves";
import {
  buildSession,
  TARGET_BOOK_CFI,
  TARGET_BOOK_TITLE,
} from "../data/stats";
import { buildReader, type Credentials, type SeededUser } from "../data/users";
import { AddBooksPage } from "../pages/AddBooksPage";
import { AdminHealthPage } from "../pages/AdminHealthPage";
import { AuthorPage } from "../pages/AuthorPage";
import { AuthorsIndexPage } from "../pages/AuthorsIndexPage";
import { BookDetailPage } from "../pages/BookDetailPage";
import { ChartBuilderPage } from "../pages/ChartBuilderPage";
import { CheckInPage } from "../pages/CheckInPage";
import { CleanupReviewPage } from "../pages/CleanupReviewPage";
import { ComicReaderPage } from "../pages/ComicReaderPage";
import { EpubReaderPage } from "../pages/EpubReaderPage";
import { IosGluePage } from "../pages/IosGluePage";
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
import { StatsPage } from "../pages/StatsPage";
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

const mutationsOn =
  (page: Page): ExpectMutation =>
  (contract, action) =>
    expectMutationOn(page, contract, action);

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
  readerSeriesPage: SeriesPage;
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
  settingsRequests: SettingsRequests;
  scratchLibrary: LibrarySettings;

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

  usersRequests: UsersRequests;
  createdUserIds: Set<number>;
  seedUser: () => Promise<SeededUser>;
  anonymousRequest: APIRequestContext;
  anonymousLogViewerRequests: LogViewerRequests;
  metadataKeysRequests: MetadataKeysRequests;
  savedMetadataKeys: Set<MetadataProvider>;
  cleanupReviewPage: CleanupReviewPage;
  adminHealthPage: AdminHealthPage;

  bookRatingRequests: BookRatingRequests;
  ebooksRequests: EbooksRequests;
  ratedBookUuids: Set<string>;
  setScrollStops: (
    enabled: boolean,
    owner?: "admin" | "reader",
  ) => Promise<void>;
  startReadStatusAt: (bookUuid: string, status: ReadStatus) => Promise<void>;
  clearHighlights: (bookUuid: string) => Promise<void>;
  mergedMp3Book: string;

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

  metadataEditPage: MetadataEditPage;
  overriddenBookUuids: Set<string>;
  assignGenres: (bookUuid: string, genres: string[]) => Promise<void>;

  addBooksPage: AddBooksPage;
  notFoundPage: NotFoundPage;
  preHydration: PreHydrationComponent;
  thumbsRequests: ThumbsRequests;
  revertOverridesOf: (...titles: string[]) => Promise<void>;
  presetStackSeries: (enabled: boolean) => Promise<void>;

  shelvesIndexPage: ShelvesIndexPage;
  seedResumePoint: (bookUuid: string) => Promise<void>;

  filterShelf: FilterShelf;

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

  crossFormatRequests: CrossFormatRequests;
  audioFileId: (bookUuid: string) => Promise<number>;
  resumePromptUuid: string;
  linkedBookUuids: Set<string>;
  eventClock: EventClock;
  newestStoredClock: (bookUuid: string) => Promise<number>;

  statsPage: StatsPage;
  chartBuilderPage: ChartBuilderPage;
  statsRequests: StatsRequests;
  secondReaderExpectMutation: ExpectMutation;
  householdTarget: ReaderAccount;

  iosGluePage: IosGluePage;
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

/** The uuid of `book` once it lists both an ebook and an audio format. */
async function bothFormatsUuid(
  request: APIRequestContext,
  book: { title: string },
  timeout: number,
): Promise<string> {
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
        match = books.find((b) => b.title === book.title);
        if (match === undefined) return false;
        return match.formats.some(isEbook) && match.formats.some(isAudio);
      },
      {
        message: `book ${JSON.stringify(book.title)} never surfaced with both an ebook and an audio format`,
        timeout,
        intervals: [100, 200, 500, 1_000, 2_000],
      },
    )
    .toBe(true);

  if (!match?.unique_identifier) {
    throw new Error(`book ${JSON.stringify(book.title)} is missing its uuid`);
  }
  return match.unique_identifier;
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
    await use(mutationsOn(page));
  },
  // A reader's UI writes happen on its own page, not the test's.
  readerExpectMutation: async ({ readerPage }, use) => {
    await use(mutationsOn(readerPage));
  },
  secondReaderExpectMutation: async ({ secondReaderPage }, use) => {
    await use(mutationsOn(secondReaderPage));
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
    { presetReadStatus, progressRequests, clearHighlights, bookmarksRequests },
    use,
  ) => {
    await use(async (bookUuid, anchor, status) => {
      await clearHighlights(bookUuid);

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

  adminWishlist: async ({ adminSession, shelvesRequests }, use) => {
    const listed = await shelvesRequests.getShelves();
    await expect(listed).toBeOK();
    await use(wishlistOf(await listed.json(), adminSession.user.id));
  },

  // A combined book count can land before the second scan attaches the other
  // format, so poll until the book lists both an ebook and an audio format.
  dualFormatUuid: async ({ request }, use) => {
    await use(await bothFormatsUuid(request, DUAL_FORMAT_BOOK, 20_000));
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
  readerSeriesPage: async ({ readerPage }, use) => {
    await use(new SeriesPage(readerPage));
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
  settingsRequests: async ({ request }, use) => {
    await use(new SettingsRequests(request));
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
        // A reindex beside the undo can leave the database locked for a moment,
        // and a merge that outlives the test breaks every later reader of it.
        await expect
          .poll(
            async () => (await mergeRequests.postUndo(mergeLogId)).status(),
            {
              message: `undo merge ${mergeLogId}`,
            },
          )
          .toBe(200);
      }
    });
  },

  // Library paths are server-wide, so saving a test's own repoints every reader
  // of the shared library until they are put back. The lock keeps two saving
  // tests from taking each other's scratch paths for the original.
  scratchLibrary: async ({ settingsRequests }, use) => {
    await withLock("library-settings", async () => {
      const before = await settingsRequests.getSettings();
      await expect(before, "read the library settings").toBeOK();
      const original: ServerLibrary = await before.json();
      await use({
        ebook_library_path: "/tmp/omnibus-test-ebooks",
        audiobook_library_path: "/tmp/omnibus-test-audiobooks",
      });
      const restored = await settingsRequests.postSettings(original);
      await expect(restored, "restore the library settings").toBeOK();
    });
  },

  registerPage: async ({ page }, use) => {
    await use(new RegisterPage(page));
  },
  mcpRequests: async ({ request }, use) => {
    await use(new McpRequests(request));
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

  // Turns the switch back off for whoever it touched, because every other
  // detail test reads the flow.
  setScrollStops: async ({ accountRequests, readerAccountRequests }, use) => {
    const touched = new Set<AccountRequests>();
    await use(async (enabled, owner = "admin") => {
      const requests =
        owner === "admin" ? accountRequests : readerAccountRequests;
      touched.add(requests);
      const saved = await requests.postScrollStops(enabled);
      await expect(saved, `set scroll stops to ${enabled}`).toBeOK();
    });
    for (const requests of touched) {
      const saved = await requests.postScrollStops(false);
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

  bookExists: async ({ ebooksRequests }, use) => {
    await use(async (bookUuid) => {
      const detail = await ebooksRequests.postEbookDetail(bookUuid);
      if (detail.status() !== 200) return false;
      return (await detail.json()) !== null;
    });
  },

  metadataEditPage: async ({ page }, use) => {
    await use(new MetadataEditPage(page));
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

  addBooksPage: async ({ page }, use) => {
    await use(new AddBooksPage(page));
  },
  notFoundPage: async ({ page }, use) => {
    await use(new NotFoundPage(page));
  },
  preHydration: async ({ page }, use) => {
    await use(new PreHydrationComponent(page));
  },
  thumbsRequests: async ({ request }, use) => {
    await use(new ThumbsRequests(request));
  },

  // Registered before the edit, so the revert runs even when the edit fails.
  revertOverridesOf: async ({ request, overriddenBookUuids }, use) => {
    await use(async (...titles) => {
      for (const title of titles) {
        overriddenBookUuids.add(await fetchBookUuidByTitle(request, title));
      }
    });
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

  shelvesIndexPage: async ({ page }, use) => {
    await use(new ShelvesIndexPage(page));
  },
  seedResumePoint: async ({ progressRequests }, use) => {
    await use(async (bookUuid) => {
      const saved = await progressRequests.postResumePoint(bookUuid);
      await expect(saved, `seed progress for ${bookUuid}`).toBeOK();
    });
  },

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

  indexedBooks: async ({ ebooksRequests }, use) => {
    await use(async () => {
      const listed = await ebooksRequests.getEbooks();
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
    const uploaded = new Set<number>();
    await use(async (authorId) => {
      const put = await authorsRequests.putPhoto(authorId);
      expect(put.status(), `upload a photo for author ${authorId}`).toBe(204);
      uploaded.add(authorId);
    });
    for (const authorId of uploaded) {
      const deleted = await authorsRequests.deletePhoto(authorId);
      await expect(deleted, `delete the photo of author ${authorId}`).toBeOK();
    }
  },

  recentBook: async ({ request, ebooksRequests }, use) => {
    await use(async (format, bookFileId) => {
      const target = FIXTURE_BOOKS[1]!;
      const uuid = await fetchBookUuidByTitle(request, target.title);
      const listed = await ebooksRequests.getEbooks();
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

  crossFormatRequests: async ({ request }, use) => {
    await use(new CrossFormatRequests(request));
  },

  // Every audio progress save names the file the player loaded (#1888).
  audioFileId: async ({ ebooksRequests }, use) => {
    await use(async (bookUuid) => {
      const detail = await ebooksRequests.getEbook(bookUuid);
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
    await use(await bothFormatsUuid(request, RESUME_PROMPT_BOOK, 45_000));
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

  statsPage: async ({ page }, use) => {
    await use(new StatsPage(page));
  },
  chartBuilderPage: async ({ page }, use) => {
    await use(new ChartBuilderPage(page));
  },
  statsRequests: async ({ request }, use) => {
    await use(new StatsRequests(request));
  },

  // Sharing is visible to every reader on the instance, so it goes back off
  // after each test; the library must be seeded before this runs.
  householdTarget: async (
    { request, secondReaderAccount, secondReaderRequest },
    use,
  ) => {
    const account = new AccountRequests(secondReaderRequest);
    await expect(
      await account.postShareStats(true),
      "turn the target's sharing on",
    ).toBeOK();

    const bookUuid = await fetchBookUuidByTitle(request, TARGET_BOOK_TITLE);
    const now = Math.floor(Date.now() / 1000);
    const sitting = await new StatsRequests(secondReaderRequest).postSessions([
      buildSession(bookUuid, {
        startedAt: now - 60,
        seconds: 60,
        format: "epub",
        utcOffsetMinutes: 0,
      }),
    ]);
    await expect(sitting, "seed the target's reading session").toBeOK();
    const { recorded } = await sitting.json();
    expect(recorded, "the target's session was skipped").toBe(1);
    const placed = await new ProgressRequests(
      secondReaderRequest,
    ).postEpubPosition(bookUuid, TARGET_BOOK_CFI);
    await expect(placed, "seed the target's reading position").toBeOK();

    await use(secondReaderAccount);

    await expect(
      await account.postShareStats(false),
      "turn the target's sharing off",
    ).toBeOK();
  },

  iosGluePage: async ({ page }, use) => {
    await use(new IosGluePage(page));
  },
});

export { expect };
