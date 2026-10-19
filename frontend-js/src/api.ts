// The wire types and their zod schemas are generated from openapi/openapi.json
// (`pnpm run generate`), and the generated fetchers validate every response, except
// a nullable or inline-array 200, which `fetchJson` parses.
// `src/api/*.ts` turns the wire shapes into the ones the screens render, one file per
// resource; this barrel keeps the screens' imports stable.

export * from "./api/account";
export * from "./api/admin";
export * from "./api/auth";
export * from "./api/books";
export * from "./api/core";
export * from "./api/discovery";
export * from "./api/goals";
export * from "./api/journal";
export * from "./api/library";
export * from "./api/metadata";
export * from "./api/physical";
export * from "./api/reading";
export * from "./api/scan";
export * from "./api/shelves";
export * from "./api/uploads";
