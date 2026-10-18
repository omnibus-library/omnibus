import { type ExpectMutationOptions, post } from "../utils/api";

/** The inspect endpoints the add-books page posts a pick to. */
export const uploadsUrls = {
  inspectEbook: /\/api\/uploads\/ebooks\/inspect(?:\?|$)/,
  inspectAudiobook: /\/api\/uploads\/audiobooks\/inspect(?:\?|$)/,
};

/** The reads that open the review form; they create nothing. */
export const uploads = {
  inspectEbook: (): ExpectMutationOptions => post(uploadsUrls.inspectEbook),

  inspectAudiobook: (): ExpectMutationOptions =>
    post(uploadsUrls.inspectAudiobook),
};
