import type { ExpectMutationOptions } from "../utils/api";

/** The inspect endpoints the add-books page posts a pick to. */
export const uploadsUrls = {
  inspectEbook: /\/api\/uploads\/ebooks\/inspect(?:\?|$)/,
  inspectAudiobook: /\/api\/uploads\/audiobooks\/inspect(?:\?|$)/,
};

function inspect(url: RegExp): ExpectMutationOptions {
  return { method: "POST", url, expectedStatus: 200 };
}

/** The reads that open the review form; they create nothing. */
export const uploads = {
  inspectEbook: (): ExpectMutationOptions => inspect(uploadsUrls.inspectEbook),

  inspectAudiobook: (): ExpectMutationOptions =>
    inspect(uploadsUrls.inspectAudiobook),
};
