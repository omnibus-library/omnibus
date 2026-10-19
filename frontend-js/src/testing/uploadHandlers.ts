import { HttpResponse, http } from "msw";
import type {
  AudiobookInspection,
  UploadInspection,
} from "../api/generated/schemas";

// MSW fakes and fixtures for the add books page.

// A one-pixel PNG, so the staged cover has something to draw.
export const PREVIEW =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

/** What reading an EPUB turns up: every field the review form shows. */
export function anEbookInspection(
  overrides: Partial<UploadInspection> = {},
): UploadInspection {
  return {
    title: "The Salt Road",
    author: "Mara Okafor",
    creators: ["Mara Okafor", "Jun Aoki"],
    series: "Tidewater",
    series_index: "2",
    language: "en",
    has_cover: true,
    ext: "epub",
    description: "A caravan crosses the dry sea.",
    publisher: "Lantern Press",
    published: "2020-05-01",
    subjects: ["travel"],
    isbn13: "9780134685991",
    identifiers: [{ scheme: "ISBN", value: "9780134685991" }],
    cover_preview: PREVIEW,
    ...overrides,
  };
}

/** What reading an audiobook's tags turns up: a title and an artist. */
export function anAudiobookInspection(
  overrides: Partial<AudiobookInspection> = {},
): AudiobookInspection {
  return {
    title: "Harbour Lights",
    author: "Ines Varga",
    creators: ["Ines Varga"],
    has_cover: false,
    format: "m4b",
    part_count: 1,
    duration_seconds: 7200,
    cover_preview: null,
    ...overrides,
  };
}

type Refusal = { status: number; text: string };

/**
 * `POST /api/uploads/ebooks/inspect` and `.../audiobooks/inspect`. The names of
 * the files each request carried land in `inspected`; with `refuse` set, that
 * status and plain text; `gate` holds the answer until it resolves.
 */
export function inspectHandlers(
  {
    ebook = anEbookInspection(),
    audiobook = anAudiobookInspection(),
  }: { ebook?: UploadInspection; audiobook?: AudiobookInspection } = {},
  {
    inspected = [],
    refuse,
    gate,
  }: {
    inspected?: string[][];
    refuse?: Refusal;
    gate?: Promise<void>;
  } = {},
) {
  const answer =
    (found: UploadInspection | AudiobookInspection) =>
    async ({ request }: { request: Request }) => {
      const files = (await request.formData()).getAll("file");
      inspected.push(files.map((f) => (f instanceof File ? f.name : "")));
      await gate;
      return refuse
        ? new HttpResponse(refuse.text, { status: refuse.status })
        : HttpResponse.json(found);
    };
  return [
    http.post("/api/uploads/ebooks/inspect", answer(ebook)),
    http.post("/api/uploads/audiobooks/inspect", answer(audiobook)),
  ];
}

/** What a commit carried: which ingest took it, and every multipart field, a file as `file:<name>`. */
export type Committed = {
  route: "ebooks" | "audiobooks";
  fields: [string, string][];
};

/**
 * `POST /api/uploads/ebooks` and `.../audiobooks`, answering 201 with `uuid`. Each
 * request lands in `committed`; with `refuse` set, that status and plain text;
 * `gate` holds the answer until it resolves.
 */
export function commitHandlers(
  uuid: string,
  {
    committed = [],
    refuse,
    gate,
  }: { committed?: Committed[]; refuse?: Refusal; gate?: Promise<void> } = {},
) {
  const answer =
    (route: Committed["route"]) =>
    async ({ request }: { request: Request }) => {
      const fields: [string, string][] = [];
      for (const [name, value] of (await request.formData()).entries()) {
        fields.push([
          name,
          value instanceof File ? `file:${value.name}` : value,
        ]);
      }
      committed.push({ route, fields });
      await gate;
      return refuse
        ? new HttpResponse(refuse.text, { status: refuse.status })
        : HttpResponse.json({ uuid }, { status: 201 });
    };
  return [
    http.post("/api/uploads/ebooks", answer("ebooks")),
    http.post("/api/uploads/audiobooks", answer("audiobooks")),
  ];
}
