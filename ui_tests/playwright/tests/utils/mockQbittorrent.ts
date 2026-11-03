import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";

/** A file the mock's download holds, listed the way qBittorrent lists it. */
export type MockFile = { name: string; size: number };

/** A running stand-in for qBittorrent, with what it was asked. */
export type MockQbittorrent = {
  /** Its address, such as `http://127.0.0.1:41234`. */
  url: string;
  /** The folder its downloads sit in, as it reports them. */
  saveDir: string;
  /** The tag of each download the server added, in order. */
  added: string[];
  /** The tag of each download the server asked it to delete, in order. */
  deleted: string[];
  /** From now on every download it holds reports as complete. */
  finish(): void;
  stop(): Promise<void>;
};

const DOWNLOADING = { progress: 0.4, state: "downloading" };
const COMPLETE = { progress: 1, state: "stalledUP" };

async function formOf(req: IncomingMessage): Promise<URLSearchParams> {
  let body = "";
  for await (const chunk of req) body += chunk;
  return new URLSearchParams(body);
}

/**
 * Starts a loopback qBittorrent that takes any login, holds each download the server adds
 * under its tag, and lists `files` inside `saveDir` for all of them. Downloads report 40%
 * until `finish()`. It stands in for a service the suite cannot run.
 */
export async function startMockQbittorrent(
  saveDir: string,
  files: MockFile[],
): Promise<MockQbittorrent> {
  const added: string[] = [];
  const deleted: string[] = [];
  const held = new Set<string>();
  let done = false;

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://mock");
    const send = (body: unknown) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const text = (body: string, headers: Record<string, string> = {}) => {
      res.writeHead(200, { "Content-Type": "text/plain", ...headers });
      res.end(body);
    };
    switch (`${req.method} ${url.pathname}`) {
      case "POST /api/v2/auth/login":
        return text("Ok.", { "Set-Cookie": "SID=e2e; path=/" });
      case "GET /api/v2/app/version":
        return text("v5.0.0");
      case "POST /api/v2/torrents/add": {
        const tag = (await formOf(req)).get("tags") ?? "";
        added.push(tag);
        held.add(tag);
        return text("Ok.");
      }
      case "GET /api/v2/torrents/info": {
        const tag = url.searchParams.get("tag") ?? "";
        if (!held.has(tag)) return send([]);
        return send([
          {
            hash: `hash-${tag}`,
            ...(done ? COMPLETE : DOWNLOADING),
            content_path: join(saveDir, files[0]?.name ?? ""),
            save_path: saveDir,
          },
        ]);
      }
      case "GET /api/v2/torrents/files":
        return send(files);
      case "POST /api/v2/torrents/delete": {
        const hashes = (await formOf(req)).get("hashes") ?? "";
        for (const hash of hashes.split("|")) {
          const tag = hash.replace(/^hash-/, "");
          held.delete(tag);
          deleted.push(tag);
        }
        return text("");
      }
      default:
        res.writeHead(404);
        return res.end();
    }
  });
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    saveDir,
    added,
    deleted,
    finish() {
      done = true;
    },
    async stop() {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
