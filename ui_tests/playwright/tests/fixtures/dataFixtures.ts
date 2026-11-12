import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { EbooksRequests } from "../apiRequests/EbooksRequests";
import type { IndexedBook } from "../data/authors";
import { isAudioFormat } from "../data/bookDetail";
import type { SeededBookmark } from "../data/bookmarks";
import { prowlarrUpdate, type RequestsConnections } from "../data/bookRequests";
import type { EbookDetail, LibraryBook, UploadedEbook } from "../data/ebooks";
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
import { isAudioPair, type MergedAudiobook } from "../data/merge";
import type { MetadataProvider } from "../data/metadataKeys";
import {
  buildNtfyConnection,
  buildPublicUrl,
  type NotificationConnection,
  type NotificationConnectionInput,
  type NotificationConnections,
  type PublicUrlStatus,
} from "../data/notifications";
import type { FiledCopy, PhysicalCopy } from "../data/physical";
import {
  type BookProgress,
  EventClock,
  type ProgressRecord,
} from "../data/progress";
import type { ReadStatus, ReadStatusRecord } from "../data/readStatus";
import { buildRecentPoint, type RecentBook } from "../data/recentProgress";
import type { BookReviews, Review, ReviewPatch } from "../data/reviews";
import type { LibrarySettings, ServerLibrary } from "../data/settings";
import {
  buildShelf,
  type NewShelf,
  type ShelfRef,
  wishlistOf,
} from "../data/shelves";
import { fetchBookUuidByTitle } from "../utils/ebooks";
import { withLock } from "../utils/lock";
import {
  type MockProwlarr,
  type MockRelease,
  startMockProwlarr,
} from "../utils/mockProwlarr";
import {
  type MockQbittorrent,
  startMockQbittorrent,
} from "../utils/mockQbittorrent";
import {
  audiobookFixturesDir,
  fixturesDir,
  LIBRARY_LOCK,
  waitForWorkerIdle,
} from "../utils/seed";
import { test as base, expect } from "./accountFixtures";
import { MERGE_PRIMARY, MERGE_SECONDARY } from "./audiobooks";
import { DUAL_FORMAT_BOOK, RESUME_PROMPT_BOOK } from "./dual_format";
import { FIXTURE_BOOKS } from "./epubs";
import { cleanupSet, type Owner } from "./lifecycle";

/** A throwaway copy of the fixture library, and the wished-for books to delete from it. */
export type ImportLibrary = { root: string; books: Set<string> };

/** A file a finished download holds: its name inside the download folder, and its bytes. */
export type DownloadedFile = { name: string; bytes: Buffer };

/** Registers merges so each is undone, newest first, before the lock frees. */
export type MergeLock = {
  undoAfter(mergeLogId: number): void;
  undone(mergeLogId: number): void;
};

/** The uuid of `book` once it lists both an ebook and an audio format. */
async function bothFormatsUuid(
  ebooks: EbooksRequests,
  book: { title: string },
  timeout: number,
): Promise<string> {
  const isEbook = (f: string) => /^(epub|pdf)$/i.test(f);

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
  await expect(listed, "GET /api/ebooks").toBeOK();
  const { books }: { books: IndexedBook[] } = await listed.json();
  return books;
}

type DataFixtures = {
  /** Set with `test.use` to point the audiobook library at a copy too, for a test that imports an audiobook. */
  audiobookImports: boolean;
  scratchLibrary: LibrarySettings;
  savedMetadataKeys: Set<MetadataProvider>;
  createdBookUuids: Set<string>;
  prowlarrFor: (releases: MockRelease[]) => Promise<MockProwlarr>;
  qbittorrentFor: (files: DownloadedFile[]) => Promise<MockQbittorrent>;
  libraryForImports: ImportLibrary;
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
  readerWishlist: ShelfRef;
  dualFormatUuid: string;
  createdShelfIds: Set<number>;
  createdReaderShelfIds: Set<number>;
  ownShelf: (
    label: string,
    shelf?: Partial<NewShelf>,
    owner?: Owner,
  ) => Promise<ShelfRef>;
  mergeLock: MergeLock;
  presetReview: (
    bookUuid: string,
    patch: ReviewPatch | null,
    owner?: Owner,
  ) => Promise<void>;
  storedReview: (bookUuid: string) => Promise<Review | null | undefined>;
  presetReadStatus: (
    bookUuid: string,
    status: ReadStatus,
    owner?: Owner,
  ) => Promise<void>;
  sweepHighlights: (bookUuid: string) => Promise<void>;
  mergedAudiobook: MergedAudiobook;
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
  scratchPublicUrl: string;
  createdNotificationIds: Set<number>;
  ntfyConnection: (
    overrides?: Partial<NotificationConnectionInput>,
  ) => Promise<NotificationConnection>;
  storedNotificationConnection: (
    id: number,
  ) => Promise<NotificationConnection | undefined>;
  offeredNotificationEvents: string[];
};

/**
 * The library's records a test reads, seeds or changes, with the cleanup that
 * deletes or restores them after `use`.
 */
export const test = base.extend<DataFixtures>({
  audiobookImports: [false, { option: true }],

  // Library paths are server-wide, so saving a test's own repoints every reader
  // of the shared library until they are put back. The lock keeps two saving
  // tests from taking each other's scratch paths for the original.
  scratchLibrary: async ({ settingsRequests }, use) => {
    await withLock(LIBRARY_LOCK, async () => {
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

  // The public URL is server-wide: the lock keeps two saving tests from taking each
  // other's URL for the original, which is put back after the test.
  scratchPublicUrl: async ({ notificationsRequests }, use) => {
    await withLock("public-url", async () => {
      const before = await notificationsRequests.getPublicUrl();
      await expect(before, "read the public URL").toBeOK();
      const original: PublicUrlStatus = await before.json();
      await use(buildPublicUrl());
      const restored = await notificationsRequests.postPublicUrl(
        original.source === "settings" ? original.url : null,
      );
      await expect(restored, "restore the public URL").toBeOK();
    });
  },

  createdNotificationIds: async ({ notificationsRequests }, use) =>
    cleanupSet(
      use,
      (id: number) => notificationsRequests.deleteConnection(id),
      (id) => `delete notification connection ${id}`,
    ),

  ntfyConnection: async (
    { notificationsRequests, createdNotificationIds },
    use,
  ) => {
    await use(async (overrides) => {
      const input = buildNtfyConnection(overrides);
      const created = await notificationsRequests.postConnection(input);
      await expect(created, `create connection ${input.name}`).toBeOK();
      const connection: NotificationConnection = await created.json();
      createdNotificationIds.add(connection.id);
      return connection;
    });
  },

  storedNotificationConnection: async ({ notificationsRequests }, use) => {
    await use(async (id) => {
      const listed = await notificationsRequests.getConnections();
      await expect(listed, "list notification connections").toBeOK();
      const { connections }: NotificationConnections = await listed.json();
      return connections.find((c) => c.id === id);
    });
  },

  // What a new connection is sent by default: the events the server offers, which
  // depend on whether it runs with book requests.
  offeredNotificationEvents: async ({ notificationsRequests }, use) => {
    const listed = await notificationsRequests.getConnections();
    await expect(listed, "list notification connections").toBeOK();
    const { available_events }: NotificationConnections = await listed.json();
    await use(available_events);
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

  // Points the server's Prowlarr connection at a mock; both are put back after the test.
  // A scratch server has no key of its own, so the fixture refuses to overwrite one.
  prowlarrFor: async ({ bookRequestsRequests }, use) => {
    const read = await bookRequestsRequests.getConnections();
    await expect(read).toBeOK();
    const before: RequestsConnections = await read.json();
    expect(before.prowlarr_api_key_masked).toBeNull();
    const started: MockProwlarr[] = [];
    await use(async (releases) => {
      const mock = await startMockProwlarr(releases);
      started.push(mock);
      const saved = await bookRequestsRequests.putConnections(
        prowlarrUpdate(before, mock.url),
      );
      await expect(saved).toBeOK();
      return mock;
    });
    const restored = await bookRequestsRequests.putConnections(
      prowlarrUpdate(before, before.prowlarr_url ?? "", ""),
    );
    await expect(restored).toBeOK();
    for (const mock of started) await mock.stop();
  },

  // Writes `files` into a fresh folder and points the download client at a mock that holds
  // them as a download, with both folder prefixes at that folder. The saved client fields
  // are put back afterwards; Prowlarr is read fresh then, so its own fixture is not undone.
  // A scratch server has no client of its own, so the fixture refuses to overwrite one.
  qbittorrentFor: async ({ bookRequestsRequests }, use) => {
    const read = await bookRequestsRequests.getConnections();
    await expect(read).toBeOK();
    const before: RequestsConnections = await read.json();
    expect(before.download_client_url).toBeNull();
    const started: { mock: MockQbittorrent; folder: string }[] = [];
    await use(async (files) => {
      const folder = mkdtempSync(join(tmpdir(), "omnibus-e2e-download-"));
      for (const { name, bytes } of files) {
        mkdirSync(dirname(join(folder, name)), { recursive: true });
        writeFileSync(join(folder, name), bytes);
      }
      const listed = files.map(({ name, bytes }) => ({
        name,
        size: bytes.length,
      }));
      const mock = await startMockQbittorrent(folder, listed);
      started.push({ mock, folder });
      const current: RequestsConnections = await (
        await bookRequestsRequests.getConnections()
      ).json();
      const saved = await bookRequestsRequests.putConnections({
        ...prowlarrUpdate(current, current.prowlarr_url ?? "", null),
        download_client_url: mock.url,
        download_client_path_prefix: folder,
        download_path_prefix: folder,
      });
      await expect(saved).toBeOK();
      return mock;
    });
    const current: RequestsConnections = await (
      await bookRequestsRequests.getConnections()
    ).json();
    const restored = await bookRequestsRequests.putConnections(
      prowlarrUpdate(before, current.prowlarr_url ?? "", null),
    );
    await expect(restored).toBeOK();
    for (const { mock, folder } of started) {
      await mock.stop();
      rmSync(folder, { recursive: true, force: true });
    }
  },

  // Points the server's ebook library at a copy of the fixtures, so an import files its book
  // there and not in the committed tree; with `audiobookImports`, the audiobook library moves to
  // a copy too (empty when none was set), and only then, so specs reading the audiobooks elsewhere
  // never lose them. The
  // copy keeps every relative path and timestamp, so the books already indexed stay the same books. The books a test registers are deleted with
  // their files first, then the library path is put back; the lock keeps another saving test
  // from taking the copy for the original.
  libraryForImports: async (
    { request, settingsRequests, ebooksRequests, audiobookImports },
    use,
  ) => {
    await withLock(LIBRARY_LOCK, async () => {
      const before = await settingsRequests.getSettings();
      await expect(before, "read the library settings").toBeOK();
      const original: ServerLibrary = await before.json();
      const root = mkdtempSync(join(tmpdir(), "omnibus-e2e-library-"));
      cpSync(fixturesDir(), root, {
        recursive: true,
        preserveTimestamps: true,
      });
      const audioRoot = audiobookImports
        ? mkdtempSync(join(tmpdir(), "omnibus-e2e-audiobooks-"))
        : null;
      // With no audiobook library set there are no indexed audiobooks to keep, and a copy's books
      // would outlive its folder once the setting is cleared.
      if (audioRoot && original.audiobook_library_path) {
        cpSync(audiobookFixturesDir(), audioRoot, {
          recursive: true,
          preserveTimestamps: true,
        });
      }
      const moved = await settingsRequests.postSettings({
        ...original,
        ebook_library_path: root,
        audiobook_library_path: audioRoot ?? original.audiobook_library_path,
      });
      await expect(moved, "point the libraries at the copies").toBeOK();
      await waitForWorkerIdle(request);
      const books = new Set<string>();
      await use({ root, books });
      for (const uuid of books) {
        const manifest = await ebooksRequests.getDeletionManifest(uuid);
        await expect(manifest).toBeOK();
        const { files, copies } = await manifest.json();
        const deleted = await ebooksRequests.postDeleteFiles(uuid, {
          file_ids: files.map((f: { id: number }) => f.id),
          copy_ids: copies.map((c: { id: number }) => c.id),
        });
        await expect(deleted, `delete ${uuid} with its files`).toBeOK();
      }
      const restored = await settingsRequests.postSettings(original);
      await expect(restored, "restore the library settings").toBeOK();
      await waitForWorkerIdle(request);
      rmSync(root, { recursive: true, force: true });
      if (audioRoot) rmSync(audioRoot, { recursive: true, force: true });
    });
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
    { setReadStatus, progressRequests, sweepHighlights, bookmarksRequests },
    use,
  ) => {
    await use(async (bookUuid, anchor, status) => {
      await sweepHighlights(bookUuid);

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

  // The worker's reader writes only their own wishlist, so a count read there
  // can't move under another worker's specs the way the admin's can.
  readerWishlist: async ({ readerAccount, readerShelvesRequests }, use) => {
    const listed = await readerShelvesRequests.getShelves();
    await expect(listed).toBeOK();
    await use(wishlistOf(await listed.json(), readerAccount.id));
  },

  // A combined book count can land before the second scan attaches the other
  // format, so poll until the book lists both an ebook and an audio format.
  dualFormatUuid: async ({ ebooksRequests }, use) => {
    await use(await bothFormatsUuid(ebooksRequests, DUAL_FORMAT_BOOK, 20_000));
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
  // the merged fixture must be restored before the next writer starts. The
  // wait for the lock counts toward the test's timeout.
  mergeLock: async ({ mergeRequests }, use, testInfo) => {
    testInfo.slow();
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

  // Patches the owner's review now, or deletes it for null, and deletes every
  // review it touched after the test.
  presetReview: async ({ reviewsRequests, readerReviewsRequests }, use) => {
    const of = (owner: Owner) =>
      owner === "admin" ? reviewsRequests : readerReviewsRequests;
    await cleanupSet(
      (touched: Set<string>) =>
        use(async (bookUuid, patch, owner = "admin") => {
          touched.add(JSON.stringify([owner, bookUuid]));
          const written =
            patch === null
              ? await of(owner).deleteReview(bookUuid)
              : await of(owner).patchReview(bookUuid, patch);
          await expect(written, `preset the ${owner}'s review`).toBeOK();
        }),
      (key) => {
        const [owner, uuid]: [Owner, string] = JSON.parse(key);
        return of(owner).deleteReview(uuid);
      },
      (key) => `delete the review ${key}`,
    );
  },

  // Undefined on a failed read, so only a real "no review" answer reads as null.
  storedReview: async ({ reviewsRequests }, use) => {
    await use(async (bookUuid) => {
      const response = await reviewsRequests.getReviews(bookUuid);
      if (!response.ok()) return undefined;
      const reviews: BookReviews = await response.json();
      return reviews.mine;
    });
  },

  // Sets the owner's status now and puts each book it touched back to unread
  // after the test.
  presetReadStatus: async (
    { setReadStatus, readerReadStatusRequests },
    use,
  ) => {
    const set = async (bookUuid: string, status: ReadStatus, owner: Owner) => {
      if (owner === "admin") return setReadStatus(bookUuid, status);
      const saved = await readerReadStatusRequests.putReadStatus(
        bookUuid,
        status,
      );
      await expect(saved, `preset the reader's status to ${status}`).toBeOK();
    };
    const started = new Map<string, [Owner, string]>();
    await use(async (bookUuid, status, owner = "admin") => {
      started.set(`${owner}:${bookUuid}`, [owner, bookUuid]);
      await set(bookUuid, status, owner);
    });
    for (const [owner, uuid] of started.values()) {
      await set(uuid, "unread", owner);
    }
  },

  sweepHighlights: async ({ highlightsRequests }, use) => {
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
  mergedAudiobook: async (
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
    const book: EbookDetail = await detail.json();
    const audioFileIds = (book.book_files ?? [])
      .filter((file) => isAudioFormat(file.format))
      .map((file) => file.id);
    if (!isAudioPair(audioFileIds)) {
      throw new Error(
        `expected two audio files after the merge, got ${audioFileIds.length}`,
      );
    }
    await use({ uuid: primaryUuid, audioFileIds });
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
      const detail = await ebooksRequests.getEbook(bookUuid);
      return detail.status() === 200;
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
      await expect(listed, "GET /api/ebooks").toBeOK();
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
      const book: EbookDetail = await detail.json();
      const audio = book.book_files?.find((file) => isAudioFormat(file.format));
      if (!audio) throw new Error(`book ${bookUuid} has no audio file`);
      return audio.id;
    });
  },

  // The reserved pair's two scans can land apart, so poll until it lists both
  // an ebook and an audio format.
  resumePromptUuid: async ({ ebooksRequests }, use) => {
    await use(
      await bothFormatsUuid(ebooksRequests, RESUME_PROMPT_BOOK, 45_000),
    );
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
        const stored = await progressRequests.getProgress(bookUuid, format);
        if (stored.status() !== 200) continue;
        const envelope: {
          records: { client_updated_at: number | null }[];
        } | null = await stored.json();
        for (const record of envelope?.records ?? []) {
          newest = Math.max(newest, record.client_updated_at ?? 0);
        }
      }
      return newest;
    });
  },
});

export { expect };
