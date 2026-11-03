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

/** The download client fields of a connections update. */
export type ClientFields = Pick<
  RequestsConnectionsUpdate,
  | "download_client_url"
  | "download_client_username"
  | "download_client_category"
  | "download_client_path_prefix"
  | "download_path_prefix"
>;

/** The client fields `connections` holds, for putting back later. */
export function clientFieldsOf(connections: RequestsConnections): ClientFields {
  return {
    download_client_url: connections.download_client_url ?? "",
    download_client_username: connections.download_client_username ?? "",
    download_client_category: connections.download_client_category,
    download_client_path_prefix: connections.download_client_path_prefix ?? "",
    download_path_prefix: connections.download_path_prefix ?? "",
  };
}

/**
 * The update that gives the download client `client` and leaves Prowlarr as `current` has
 * it, key and all.
 */
export function clientUpdate(
  current: RequestsConnections,
  client: ClientFields,
): RequestsConnectionsUpdate {
  return {
    ...prowlarrUpdate(current, current.prowlarr_url ?? "", null),
    ...client,
  };
}

/** The versions the mock Prowlarr offers for `book`: a retail EPUB and a smaller PDF. */
export function releasesFor(book: ExternalBookMeta) {
  const named = (format: string) =>
    `${book.title} - ${book.authors.join(", ")} [${format}]`;
  const release = (
    format: string,
    size: number,
    seeders: number,
    indexer: string,
  ) => ({
    guid: `${book.isbn13}-${format}`,
    title: named(format),
    size,
    seeders,
    indexer,
    downloadUrl: `http://127.0.0.1:1/download/${book.isbn13}-${format}`,
    categories: [{ id: 7020 }],
  });
  return [
    release("PDF", 6_400_000, 3, "E2E Library Ink"),
    release("EPUB", 1_200_000, 14, "E2E Books"),
  ];
}
