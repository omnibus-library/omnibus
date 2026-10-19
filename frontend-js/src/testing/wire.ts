import type { EbookMetadata, UserSummary } from "../api/generated/schemas";

// Fixtures in the shape the server sends them: snake_case JSON, typed by the
// generated schemas so a fixture that drifts from the spec fails to compile.
// Kept beside the parsed fixtures in books.ts.

/** A book as `GET /api/ebooks` and `GET /api/ebooks/{uuid}` send it. */
export function aWireBook(
  overrides: Partial<EbookMetadata> = {},
): EbookMetadata {
  return {
    id: 2,
    filename: "aurora-station-01.cbz",
    title: "Aurora Station, Vol. 1",
    description: null,
    publisher: null,
    published: "2021-03-01",
    language: null,
    creators: [{ name: "Sora Inkwell", role: null, file_as: null, id: 2 }],
    subjects: [],
    identifiers: [],
    series: "Aurora Station",
    series_index: "1",
    unique_identifier: "ec8495e8-0ce8-4cb1-8c1d-b646b0a717e0",
    cover_url: "/api/covers/ec8495e8-0ce8-4cb1-8c1d-b646b0a717e0",
    accent: "oklch(0.555 0.153 28.4)",
    formats: ["CBZ"],
    error: null,
    has_override: false,
    has_cover_override: false,
    ...overrides,
  };
}

/** `count` distinct books, uuids and titles numbered, for paging. */
export function aWireLibrary(count: number): EbookMetadata[] {
  return Array.from({ length: count }, (_, i) =>
    aWireBook({
      id: i + 1,
      title: `Aurora Station, Vol. ${i + 1}`,
      series_index: String(i + 1),
      unique_identifier: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
    }),
  );
}

/** The signed-in admin as `GET /api/auth/me` and the login response send it. */
export const WIRE_ADA: UserSummary = {
  id: 1,
  username: "ada",
  display_name: "Ada Lovelace",
  is_admin: true,
  can_upload: true,
  can_edit: true,
  can_download: true,
  kindle_email: null,
};
