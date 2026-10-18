import type { Page, Request, Response } from "@playwright/test";
import { PreHydrationComponent } from "../components/PreHydrationComponent";
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
import { test as base, expect } from "./dataFixtures";

/** `expectMutation` from `utils/api`, bound to the test's page. */
export type ExpectMutation = <T>(
  contract: ExpectMutationOptions,
  action: () => Promise<T>,
) => Promise<{ result: T; request: Request; response: Response }>;

const mutationsOn =
  (page: Page): ExpectMutation =>
  (contract, action) =>
    expectMutationOn(page, contract, action);

type PageFixtures = {
  expectMutation: ExpectMutation;
  readerExpectMutation: ExpectMutation;
  secondReaderExpectMutation: ExpectMutation;
  libraryPage: LibraryPage;
  bookDetailPage: BookDetailPage;
  checkInPage: CheckInPage;
  epubReaderPage: EpubReaderPage;
  comicReaderPage: ComicReaderPage;
  pdfReaderPage: PdfReaderPage;
  shelfPage: ShelfPage;
  readerLibraryPage: LibraryPage;
  readerBookDetailPage: BookDetailPage;
  readerSettingsPage: SettingsPage;
  readerShelfPage: ShelfPage;
  readerSeriesPage: SeriesPage;
  secondReaderSettingsPage: SettingsPage;
  settingsPage: SettingsPage;
  loginPage: LoginPage;
  authorsIndexPage: AuthorsIndexPage;
  listenPage: ListenPage;
  registerPage: RegisterPage;
  cleanupReviewPage: CleanupReviewPage;
  adminHealthPage: AdminHealthPage;
  metadataEditPage: MetadataEditPage;
  addBooksPage: AddBooksPage;
  notFoundPage: NotFoundPage;
  preHydration: PreHydrationComponent;
  shelvesIndexPage: ShelvesIndexPage;
  searchResultsPage: SearchResultsPage;
  authorPage: AuthorPage;
  seriesPage: SeriesPage;
  seriesIndexPage: SeriesIndexPage;
  statsPage: StatsPage;
  chartBuilderPage: ChartBuilderPage;
  iosGluePage: IosGluePage;
};

/**
 * The suite admin's fixtures: its page and page objects, and `expectMutation`
 * bound to each page a spec drives. `readerFixtures.ts` signs the page in as
 * the worker's reader.
 */
export const test = base.extend<PageFixtures>({
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

  registerPage: async ({ page }, use) => {
    await use(new RegisterPage(page));
  },

  cleanupReviewPage: async ({ page }, use) => {
    await use(new CleanupReviewPage(page));
  },

  adminHealthPage: async ({ page }, use) => {
    await use(new AdminHealthPage(page));
  },

  metadataEditPage: async ({ page }, use) => {
    await use(new MetadataEditPage(page));
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

  shelvesIndexPage: async ({ page }, use) => {
    await use(new ShelvesIndexPage(page));
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

  statsPage: async ({ page }, use) => {
    await use(new StatsPage(page));
  },

  chartBuilderPage: async ({ page }, use) => {
    await use(new ChartBuilderPage(page));
  },

  iosGluePage: async ({ page }, use) => {
    await use(new IosGluePage(page));
  },
});

export { expect };
