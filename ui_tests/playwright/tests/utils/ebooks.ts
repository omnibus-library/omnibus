import type { APIRequestContext } from "@playwright/test";
import { expect } from "../fixtures/test";

/**
 * Looks up a seeded book's `uuid` by exact title, polling until it is indexed.
 * A uuid is a random v4 minted once per book, so it survives reindexes.
 */
export async function fetchBookUuidByTitle(
  request: APIRequestContext,
  title: string,
): Promise<string> {
  // Poll rather than read once. `seedLibrary`/`seedAudiobookLibrary` gate on a
  // *total* book count from `/api/rpc/ebooks`, which a parallel spec's ebooks
  // can satisfy before this spec's own reindex has surfaced `title` — so a
  // single GET here races the indexer and throws "no seeded book". Retrying
  // until the specific title appears absorbs that lag; a genuinely-absent book
  // still fails after the timeout with the same diagnostic.
  let lastCount = -1;
  let match:
    | { unique_identifier: string | null; title: string | null }
    | undefined;
  await expect
    .poll(
      async () => {
        const resp = await request.get("/api/rpc/ebooks");
        if (resp.status() !== 200) return false;
        const body = (await resp.json()) as {
          books: { unique_identifier: string | null; title: string | null }[];
        };
        lastCount = body.books.length;
        match = body.books.find((b) => b.title === title);
        return match !== undefined;
      },
      {
        message: `no seeded book with title ${JSON.stringify(title)} surfaced by /api/rpc/ebooks`,
        timeout: 15_000,
        intervals: [100, 200, 500, 1_000],
      },
    )
    .toBe(true);

  if (!match) {
    throw new Error(
      `no seeded book with title ${JSON.stringify(title)} (got ${lastCount} books)`,
    );
  }
  if (!match.unique_identifier) {
    throw new Error(`book ${JSON.stringify(title)} is missing its uuid`);
  }
  return match.unique_identifier;
}
