/** The merged audiobook, and the ids of its two audio files in picker order. */
export type MergedAudiobook = {
  uuid: string;
  audioFileIds: [number, number];
};

/** True for the two audio files a merge of the reserved pair leaves. */
export function isAudioPair(ids: number[]): ids is [number, number] {
  return ids.length === 2;
}
