import { HttpResponse, http } from "msw";
import { type ProgressRecord, ProgressUpdate } from "../api/generated/schemas";
import { COVER_SVG } from "./books";
import { aWirePosition, aWireProgress } from "./wire";

// MSW fakes for the routes the readers call beyond the book itself.

/**
 * The progress `GET` serves `initial`; a `POST` appends its body to `writes` and answers
 * the position it stored.
 */
export function progressHandlers(
  initial: ProgressRecord[],
  writes: ProgressUpdate[],
) {
  return [
    http.get("/api/progress/:uuid", () =>
      HttpResponse.json(aWireProgress(...initial)),
    ),
    http.post("/api/progress", async ({ request }) => {
      const body = ProgressUpdate.parse(await request.json());
      writes.push(body);
      return HttpResponse.json(
        aWirePosition({
          book_uuid: body.book_uuid,
          epub_cfi: body.epub_cfi,
          progress_percent: body.progress_percent,
        }),
      );
    }),
  ];
}

/** Every comic page is the sample cover. */
export const comicPageHandler = http.get(
  "/api/ebooks/:uuid/pages/:page",
  () =>
    new HttpResponse(COVER_SVG, {
      headers: { "Content-Type": "image/svg+xml" },
    }),
);
