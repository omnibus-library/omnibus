import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { APIRequestContext } from "@playwright/test";
import { EbooksRequests } from "../apiRequests/EbooksRequests";
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
import { fetchBookUuidByTitle } from "../utils/ebooks";
import { withLock } from "../utils/lock";
import { fixturesDir } from "../utils/seed";
import { test as base, expect } from "./accountFixtures";
import { MERGE_PRIMARY, MERGE_SECONDARY } from "./audiobooks";
import { DUAL_FORMAT_BOOK, RESUME_PROMPT_BOOK } from "./dual_format";
import { FIXTURE_BOOKS } from "./epubs";
import { cleanupSet, type Owner } from "./lifecycle";

/** Registers merges so each is undone, newest first, before the lock frees. */
export type MergeLock = {
  undoAfter(mergeLogId: number): void;
  undone(mergeLogId: number): void;
};

/** The uuid of `book` once it lists both an ebook and an audio format. */
async function bothFormatsUuid(
  request: APIRequestContext,
  book: { title: string },
  timeout: number,
): Promise<string> {
  const isEbook = (f: string) => /^(epub|pdf)$/i.test(f);
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
        return match.formats.some(isEbook) && match.formats.some(isAudioFormat);
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

/** Every book the library lists, with the author and series ids the indexer gave it. */
async function indexedBooks(ebooks: EbooksRequests): Promise<IndexedBook[]> {
  const listed = await ebooks.getEbooks();
  await expect(listed, "GET /api/rpc/ebooks").toBeOK();
  const { books }: { books: IndexedBook[] } = await listed.json();
  return books;
}

type DataFixtures = {
  scratchLibrary: LibrarySettings;
  savedMetadataKeys: Set<MetadataProvider>;
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
  setReadStatus: (bookUuid: string, status: ReadStatus) => Promise<void>;
  parkBook: (
    bookUuid: string,
    anchor: string,
    status: ReadStatus,
  ) => Promise<void>;
  adminWishlist: ShelfRef;
  dualFormatUuid: string;
  createdShelfIds: Set<number>;
  createdReaderShelfIds: Set<number>;
  ownShelf: (
    label: string,
    shelf?: Partial<NewShelf>,
    owner?: Owner,
  ) => Promise<ShelfRef>;
  mergeLock: MergeLock;
  ratedBookUuids: Set<string>;
  presetReadStatus: (bookUuid: string, status: ReadStatus) => Promise<void>;
  clearHighlights: (bookUuid: string) => Promise<void>;
  mergedMp3Book: string;
  createdJournalIds: Set<number>;
  journalEntryOn: (
    bookUuid: string,
    body: string,
    status?: JournalStatus,
  ) => Promise<JournalEntryRef>;
  uploadedEbook: UploadedEbook;
  bookExists: (bookUuid: string) => Promise<boolean>;
  overriddenBookUuids: Set<string>;
  assignGenres: (bookUuid: string, genres: string[]) => Promise<void>;
  revertOverridesOf: (...titles: string[]) => Promise<void>;
  seedResumePoint: (bookUuid: string) => Promise<void>;
  filterShelf: FilterShelf;
  authorId: (name: string) => Promise<number>;
  seriesId: (name: string) => Promise<number>;
  linkedAuthorNames: () => Promise<string[]>;
  deletedAuthors: Set<string>;
  photographedAuthorIds: Set<number>;
  uploadAuthorPhoto: (authorId: number) => Promise<void>;
  recentBook: (
    format: "epub" | "audio",
    bookFileId?: number,
  ) => Promise<RecentBook>;
  audioFileId: (bookUuid: string) => Promise<number>;
  resumePromptUuid: string;
  linkedBookUuids: Set<string>;
  eventClock: EventClock;
  newestStoredClock: (bookUuid: string) => Promise<number>;
};

/**
 * The library's records a test reads, seeds or changes, with the cleanup that
 * deletes or restores them after `use`.
 */
export const test = base.extend<DataFixtures>({
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

  savedMetadataKeys: async ({ metadataKeysRequests }, use) =>
    cleanupSet(
      use,
      (provider: MetadataProvider) =>
        metadataKeysRequests.postKey(provider, null),
      (provider) => `clear ${provider} key`,
    ),

  createdBookUuids: async ({ physicalRequests }, use) =>
    cleanupSet(
      use,
      (uuid: string) => physicalRequests.deleteBook(uuid),
      (uuid) => `delete ${uuid}`,
    ),

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

  seededHighlightIds: async ({ highlightsRequests }, use) =>
    cleanupSet(
      use,
      (id: number) => highlightsRequests.deleteHighlight(id),
      (id) => `delete highlight ${id}`,
    ),

  seededBookmarkIds: async ({ bookmarksRequests }, use) =>
    cleanupSet(
      use,
      (id: number) => bookmarksRequests.deleteBookmark(id),
      (id) => `delete bookmark ${id}`,
    ),

  highlightOn: async ({ highlightsRequests, seededHighlightIds }, use) => {
    await use(async (bookUuid, overrides) => {
      const highlight = buildHighlight(bookUuid, overrides);
      const created = await highlightsRequests.postHighlight(highlight);
      await expect(created, "seed highlight").toBeOK();
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
  setReadStatus: async ({ readStatusRequests, storedReadStatus }, use) => {
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
    { setReadStatus, progressRequests, clearHighlights, bookmarksRequests },
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

      await setReadStatus(bookUuid, status);
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

  createdShelfIds: async ({ shelvesRequests }, use) =>
    cleanupSet(
      use,
      (id: number) => shelvesRequests.deleteShelf(id),
      (id) => `delete shelf ${id}`,
    ),

  createdReaderShelfIds: async ({ readerShelvesRequests }, use) =>
    cleanupSet(
      use,
      (id: number) => readerShelvesRequests.deleteShelf(id),
      (id) => `delete the reader's shelf ${id}`,
    ),

  ownShelf: async (
    {
      shelvesRequests,
      readerShelvesRequests,
      createdShelfIds,
      createdReaderShelfIds,
    },
    use,
  ) => {
    await use(async (label, shelf, owner = "admin") => {
      const [requests, ids] =
        owner === "admin"
          ? [shelvesRequests, createdShelfIds]
          : [readerShelvesRequests, createdReaderShelfIds];
      const req = buildShelf(label, shelf);
      const created = await requests.postShelf(req);
      await expect(created, `create shelf ${req.name}`).toBeOK();
      const { id } = await created.json();
      ids.add(id);
      return { id, name: req.name };
    });
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
              timeout: 30_000,
              intervals: [200, 500, 1_000],
            },
          )
          .toBe(200);
      }
    });
  },

  ratedBookUuids: async ({ bookRatingRequests }, use) =>
    cleanupSet(
      use,
      (uuid: string) => bookRatingRequests.deleteRating(uuid),
      (uuid) => `clear the rating on ${uuid}`,
    ),

  // Sets the status now and puts the book back to unread after the test.
  presetReadStatus: async ({ setReadStatus }, use) => {
    const started = new Set<string>();
    await use(async (bookUuid, status) => {
      started.add(bookUuid);
      await setReadStatus(bookUuid, status);
    });
    for (const uuid of started) await setReadStatus(uuid, "unread");
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

  createdJournalIds: async ({ journalsRequests }, use) =>
    cleanupSet(
      use,
      (id: number) => journalsRequests.deleteJournal(id),
      (id) => `delete journal entry ${id}`,
    ),

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
    await expect(uploaded, "upload the deletable ebook").toBeOK();
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

  // Drops what a test left on the books it registers, covers included, so the
  // next test starts from the scanned values.
  overriddenBookUuids: async ({ overridesRequests }, use) =>
    cleanupSet(
      use,
      (uuid: string) => overridesRequests.deleteOverrides(uuid),
      (uuid) => `revert overrides on ${uuid}`,
    ),

  assignGenres: async ({ overridesRequests, overriddenBookUuids }, use) => {
    await use(async (bookUuid, genres) => {
      const assigned = await overridesRequests.postOverrides(bookUuid, {
        genres,
      });
      await expect(assigned, "assign genres").toBeOK();
      overriddenBookUuids.add(bookUuid);
    });
  },

  // Registered before the edit, so the revert runs even when the edit fails.
  revertOverridesOf: async ({ request, overriddenBookUuids }, use) => {
    await use(async (...titles) => {
      for (const title of titles) {
        overriddenBookUuids.add(await fetchBookUuidByTitle(request, title));
      }
    });
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

  authorId: async ({ ebooksRequests }, use) => {
    await use(async (name) => {
      for (const book of await indexedBooks(ebooksRequests)) {
        const match = book.creators.find((creator) => creator.name === name);
        if (match?.id) return match.id;
      }
      throw new Error(`no indexed author named ${JSON.stringify(name)}`);
    });
  },

  seriesId: async ({ ebooksRequests }, use) => {
    await use(async (name) => {
      const books = await indexedBooks(ebooksRequests);
      const match = books.find(
        (book) => book.series === name && book.series_id != null,
      );
      if (!match?.series_id) {
        throw new Error(`no indexed series named ${JSON.stringify(name)}`);
      }
      return match.series_id;
    });
  },

  linkedAuthorNames: async ({ ebooksRequests }, use) => {
    await use(async () =>
      (await indexedBooks(ebooksRequests)).flatMap((book) =>
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

  photographedAuthorIds: async ({ authorsRequests }, use) =>
    cleanupSet(
      use,
      (id: number) => authorsRequests.deletePhoto(id),
      (id) => `delete the photo of author ${id}`,
    ),

  uploadAuthorPhoto: async (
    { authorsRequests, photographedAuthorIds },
    use,
  ) => {
    await use(async (authorId) => {
      const put = await authorsRequests.putPhoto(authorId);
      await expect(put, `upload a photo for author ${authorId}`).toBeOK();
      photographedAuthorIds.add(authorId);
    });
  },

  recentBook: async ({ request, ebooksRequests }, use) => {
    await use(async (format, bookFileId) => {
      const target = FIXTURE_BOOKS[1]!;
      const uuid = await fetchBookUuidByTitle(request, target.title);
      const listed = await ebooksRequests.getEbooks();
      await expect(listed, "GET /api/rpc/ebooks").toBeOK();
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

  // Every audio progress save names the file the player loaded (#1888).
  audioFileId: async ({ ebooksRequests }, use) => {
    await use(async (bookUuid) => {
      const detail = await ebooksRequests.getEbook(bookUuid);
      await expect(detail, `read ${bookUuid}`).toBeOK();
      const { book_files }: { book_files: { id: number; format: string }[] } =
        await detail.json();
      const audio = book_files.find((file) => isAudioFormat(file.format));
      if (!audio) throw new Error(`book ${bookUuid} has no audio file`);
      return audio.id;
    });
  },

  // The reserved pair's two scans can land apart, so poll until it lists both
  // an ebook and an audio format.
  resumePromptUuid: async ({ request }, use) => {
    await use(await bothFormatsUuid(request, RESUME_PROMPT_BOOK, 45_000));
  },

  linkedBookUuids: async ({ crossFormatRequests }, use) =>
    cleanupSet(
      use,
      (uuid: string) => crossFormatRequests.postUnlink(uuid),
      (uuid) => `unlink ${uuid}`,
    ),

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
});

export { expect };
