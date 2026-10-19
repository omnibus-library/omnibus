import { defineConfig, defineTransformer, type OpenApiDocument } from "orval";

type PathItem = NonNullable<NonNullable<OpenApiDocument["paths"]>[string]>;

const METHODS = ["get", "put", "post", "delete", "patch"] as const;

/** Whether a response's body is something other than JSON, such as an image. */
function isFile(response: unknown): boolean {
  if (typeof response !== "object" || response === null) return false;
  if (!("content" in response)) return false;
  const { content } = response;
  return (
    typeof content === "object" &&
    content !== null &&
    Object.keys(content).some((type) => type !== "application/json")
  );
}

/** Whether an operation's success is a file (an image, an EPUB) rather than JSON. */
function servesFile(operation: PathItem[(typeof METHODS)[number]]): boolean {
  return Object.entries(operation?.responses ?? {}).some(
    ([status, response]) => status.startsWith("2") && isFile(response),
  );
}

// Media is loaded by URL into <img> and <audio>, never fetched, and orval's MSW
// generator can't type a file response beside an empty one, so file routes are
// left out of the generated client.
const withoutFileRoutes = defineTransformer((spec) => {
  const paths: NonNullable<OpenApiDocument["paths"]> = {};
  for (const [path, item] of Object.entries(spec.paths ?? {})) {
    if (!item) continue;
    const kept: PathItem = { ...item };
    for (const method of METHODS) {
      if (servesFile(kept[method])) delete kept[method];
    }
    if (METHODS.some((method) => kept[method])) paths[path] = kept;
  }
  return { ...spec, paths };
});

// The REST client, generated from the spec the server commits: zod schemas for
// every wire type, fetchers that validate responses with them, TanStack Query
// hooks, and MSW handlers (one per documented status) with faker data. The
// output is gitignored; `pnpm run generate` rebuilds it, and `pnpm install`
// runs that too.
export default defineConfig({
  omnibus: {
    input: {
      target: "../openapi/openapi.json",
      override: { transformer: withoutFileRoutes },
    },
    output: {
      target: "src/api/generated/omnibus.ts",
      schemas: { path: "src/api/generated/schemas", type: "zod" },
      client: "react-query",
      httpClient: "fetch",
      mode: "split",
      clean: true,
      mock: { generators: [{ type: "msw", generateEachHttpStatus: true }] },
      override: { fetch: { runtimeValidation: true } },
    },
  },
});
