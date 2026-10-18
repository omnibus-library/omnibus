import { uniqueSuffix } from "./unique";

/** A metadata provider whose API key the Metadata Lookup section saves. */
export type MetadataProvider = "hardcover" | "google-books";

const KEY_PREFIX: Record<MetadataProvider, string> = {
  hardcover: "hc",
  "google-books": "AIza",
};

/** A key no other call returns, shaped like the provider's own. */
export function buildMetadataKey(provider: MetadataProvider): string {
  return `${KEY_PREFIX[provider]}_test_${uniqueSuffix()}`;
}
