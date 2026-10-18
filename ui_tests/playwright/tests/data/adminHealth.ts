/** The report `POST /api/rpc/admin-health` answers with. */
export type AdminHealthReport = {
  index: {
    ebook_library_path: string | null;
    audiobook_library_path: string | null;
    book_count: number;
    author_count: number;
    series_count: number;
    ghosted_book_count: number;
  };
  worker_queue: {
    kind: string;
    queue_depth: number;
    recent_completions_ms: number[];
  }[];
  fts: { books_rows: number; fts_rows: number; in_sync: boolean };
  storage: {
    library_bytes: number;
    covers_bytes: number;
    thumbs_bytes: number;
    thumbs_cap_bytes: number;
    hls_bytes: number;
    hls_cap_bytes: number;
    export_epub_bytes: number;
    export_epub_cap_bytes: number;
  };
  last_errors: {
    timestamp: number;
    target: string;
    message: string;
    book_uuid?: string | null;
    file?: string | null;
  }[];
};

/** A healthy small library with 12 books, an idle worker and no errors. */
export function buildAdminHealthReport(
  overrides: Partial<AdminHealthReport> = {},
): AdminHealthReport {
  return {
    index: {
      ebook_library_path: "/data/ebooks",
      audiobook_library_path: null,
      book_count: 12,
      author_count: 4,
      series_count: 2,
      ghosted_book_count: 0,
    },
    worker_queue: [],
    fts: { books_rows: 12, fts_rows: 12, in_sync: true },
    storage: {
      library_bytes: 1_000_000,
      covers_bytes: 200_000,
      thumbs_bytes: 50_000,
      thumbs_cap_bytes: 1_000_000_000,
      hls_bytes: 0,
      hls_cap_bytes: 5_000_000_000,
      export_epub_bytes: 0,
      export_epub_cap_bytes: 5_000_000_000,
    },
    last_errors: [],
    ...overrides,
  };
}
