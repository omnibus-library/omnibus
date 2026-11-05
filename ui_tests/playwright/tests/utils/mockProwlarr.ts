import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/** The API key the mock accepts; the server sends it in `X-Api-Key`. */
export const MOCK_PROWLARR_KEY = "e2e-prowlarr-key";

/** A search result in the shape Prowlarr's `ReleaseResource` has. */
export type MockRelease = {
  guid: string;
  title: string;
  size: number;
  seeders: number;
  indexer: string;
  downloadUrl: string;
  categories: { id: number }[];
};

/** A running stand-in for Prowlarr, with what it was asked. */
export type MockProwlarr = {
  /** Its address, such as `http://127.0.0.1:41234`. */
  url: string;
  /** The `query` of each search it answered or is holding, in order. */
  searches: string[];
  /** Holds every search until the returned function runs; later searches pass straight through. */
  holdSearches(): () => void;
  stop(): Promise<void>;
};

/**
 * Starts a loopback Prowlarr that reports itself as Prowlarr, finds `releases` for any
 * search, and reports no failing indexer. It stands in for a service the suite cannot run.
 */
export async function startMockProwlarr(
  releases: MockRelease[],
): Promise<MockProwlarr> {
  const searches: string[] = [];
  let gate: Promise<void> | null = null;
  let release: () => void = () => {};

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://mock");
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.headers["x-api-key"] !== MOCK_PROWLARR_KEY) return send(401, {});
    switch (url.pathname) {
      case "/api/v1/system/status":
        return send(200, { appName: "Prowlarr", version: "1.30.2" });
      case "/api/v1/indexerstatus":
        return send(200, []);
      case "/api/v1/search":
        searches.push(url.searchParams.get("query") ?? "");
        await gate;
        return send(200, releases);
      default:
        return send(404, {});
    }
  });
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    searches,
    holdSearches() {
      gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      return () => {
        release();
        gate = null;
      };
    },
    async stop() {
      release();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
