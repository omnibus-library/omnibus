import type { Request, Response } from "@playwright/test";
import { BookDetailPage } from "../pages/BookDetailPage";
import { CheckInPage } from "../pages/CheckInPage";
import { LibraryPage } from "../pages/LibraryPage";
import { ShelfPage } from "../pages/ShelfPage";
import {
  type ExpectMutationOptions,
  expectMutation as expectMutationOn,
} from "../utils/api";
import { test as base, expect } from "./test";

/** `expectMutation` from `utils/api`, bound to the test's page. */
export type ExpectMutation = <T>(
  contract: ExpectMutationOptions,
  action: () => Promise<T>,
) => Promise<{ result: T; request: Request; response: Response }>;

type PageFixtures = {
  expectMutation: ExpectMutation;
  libraryPage: LibraryPage;
  bookDetailPage: BookDetailPage;
  checkInPage: CheckInPage;
  shelfPage: ShelfPage;
};

export const test = base.extend<PageFixtures>({
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
  shelfPage: async ({ page }, use) => {
    await use(new ShelfPage(page));
  },
});

export { expect };
