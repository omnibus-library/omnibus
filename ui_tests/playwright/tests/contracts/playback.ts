import { type ExpectMutationOptions, post } from "../utils/api";

/** The endpoints the player's speed controls read and post to. */
export const playbackUrls = {
  rate: /\/api\/rpc\/audiobooks\/playback-rate\/set(?:\?|$)/,
  savedRate: /\/api\/rpc\/audiobooks\/playback-rate\/get(?:\?|$)/,
};

/** The writes the player and the dock make to the reader's listening state. */
export const playback = {
  /** The write choosing a speed for one audiobook. */
  setRate: (bookUuid: string, rate: number): ExpectMutationOptions =>
    post(playbackUrls.rate, {
      uuid: bookUuid,
      update: { playback_rate: rate },
    }),
};
