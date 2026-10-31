import type { ExpectMutationOptions } from "../utils/api";

/** The endpoint the player's speed controls read (GET) and write (PUT). */
export const playbackUrls = {
  rate: /\/api\/audiobooks\/[^/]+\/playback-rate(?:\?|$)/,
};

/** The writes the player and the dock make to the reader's listening state. */
export const playback = {
  /** The write choosing a speed for one audiobook. */
  setRate: (bookUuid: string, rate: number): ExpectMutationOptions => ({
    method: "PUT",
    url: new RegExp(`/api/audiobooks/${bookUuid}/playback-rate(?:\\?|$)`),
    expectedBody: { playback_rate: rate },
    expectedStatus: 200,
  }),
};
