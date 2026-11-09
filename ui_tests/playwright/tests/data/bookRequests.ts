import { createHash } from "node:crypto";
import { MOCK_PROWLARR_KEY } from "../utils/mockProwlarr";
import type { ExternalBookMeta } from "./scan";

/** `GET /api/admin/requests/settings`, with both secrets masked. */
export type RequestsConnections = {
  prowlarr_url: string | null;
  prowlarr_api_key_masked: string | null;
  download_client_kind: string;
  download_client_url: string | null;
  download_client_username: string | null;
  download_client_category: string;
  download_client_path_prefix: string | null;
  download_path_prefix: string | null;
};

/** The body of `PUT /api/admin/requests/settings`. */
export type RequestsConnectionsUpdate = {
  prowlarr_url: string;
  prowlarr_api_key: string | null;
  download_client_kind: string;
  download_client_url: string;
  download_client_username: string;
  download_client_password: string | null;
  download_client_category: string;
  download_client_path_prefix: string;
  download_path_prefix: string;
};

/**
 * The update that points Prowlarr at `url` with the mock's key and leaves every other
 * connection as `before` has it. `key` is `""` to clear the saved key.
 */
export function prowlarrUpdate(
  before: RequestsConnections,
  url: string,
  key: string | null = MOCK_PROWLARR_KEY,
): RequestsConnectionsUpdate {
  return {
    prowlarr_url: url,
    prowlarr_api_key: key,
    download_client_kind: before.download_client_kind,
    download_client_url: before.download_client_url ?? "",
    download_client_username: before.download_client_username ?? "",
    download_client_password: null,
    download_client_category: before.download_client_category,
    download_client_path_prefix: before.download_client_path_prefix ?? "",
    download_path_prefix: before.download_path_prefix ?? "",
  };
}

type ReleaseSpec = {
  format: string;
  size: number;
  seeders: number;
  indexer: string;
  /** The Newznab category: 7020 for an ebook, 3030 for an audiobook. */
  category: number;
};

/** A search result for `book` in `format`. */
const release = (
  book: ExternalBookMeta,
  { format, size, seeders, indexer, category }: ReleaseSpec,
) => ({
  guid: `${book.isbn13}-${format}`,
  title: `${book.title} - ${book.authors.join(", ")} [${format}]`,
  size,
  seeders,
  indexer,
  infoUrl: `https://e2e-library.example/details/${book.isbn13}-${format}`,
  // A magnet, whose info hash is how the server finds the download again.
  downloadUrl: `magnet:?xt=urn:btih:${createHash("sha1").update(`${book.isbn13}-${format}`).digest("hex")}`,
  categories: [{ id: category }],
});

/** The versions the mock Prowlarr offers for `book`: a retail EPUB and a smaller PDF. */
export function releasesFor(book: ExternalBookMeta) {
  return [
    release(book, {
      format: "PDF",
      size: 6_400_000,
      seeders: 3,
      indexer: "E2E Library Ink",
      category: 7020,
    }),
    release(book, {
      format: "EPUB",
      size: 1_200_000,
      seeders: 14,
      indexer: "E2E Books",
      category: 7020,
    }),
  ];
}

/** The audiobook versions the mock Prowlarr offers for `book`: a single M4B and a folder of MP3s. */
export function audiobookReleasesFor(book: ExternalBookMeta) {
  return [
    release(book, {
      format: "M4B",
      size: 310_000_000,
      seeders: 9,
      indexer: "E2E Audio",
      category: 3030,
    }),
    release(book, {
      format: "MP3",
      size: 280_000_000,
      seeders: 6,
      indexer: "E2E Audio",
      category: 3030,
    }),
  ];
}
