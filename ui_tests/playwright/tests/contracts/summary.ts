/** The endpoints behind "Fetch summary", both stubbed so no provider is called. */
export const summaryUrls = {
  sources: /\/api\/summary\/sources(?:\?|$)/,
  fetch: /\/api\/ebooks\/[^/]+\/summary\/fetch(?:\?|$)/,
};
