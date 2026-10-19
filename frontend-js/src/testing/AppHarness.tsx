import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { MemoryRouter } from "react-router";
import { expect } from "storybook/test";
import { toUser, type User } from "../api";
import { SearchPaletteProvider } from "../components/SearchPalette/SearchPalette";
import { PlaybackProvider } from "../playback/PlaybackProvider";
import { meQuery } from "../session";
import { WIRE_ADA } from "./wire";

/** The signed-in reader stories and tests render as. */
export const ADA: User = toUser(WIRE_ADA);

/** A query client already holding `user` as the session, that never refetches. */
export function harnessClient(user: User | null = ADA): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      queries: { staleTime: Number.POSITIVE_INFINITY, retry: false },
    },
  });
  client.setQueryData(meQuery.queryKey, user);
  return client;
}

let current: QueryClient | undefined;

/** The client the rendered story runs under, for a play to invalidate queries with. */
export function storyClient(): QueryClient {
  if (!current) throw new Error("No story is rendered inside an AppHarness");
  return current;
}

/** Puts data under each key, so a later invalidation has something to mark stale. */
export function seedQueries(keys: unknown[][]) {
  for (const key of keys) storyClient().setQueryData(key, []);
}

/** Waits for every key's query to be marked stale. */
export async function expectInvalidated(keys: unknown[][]) {
  for (const key of keys) {
    await expect(storyClient().getQueryState(key)?.isInvalidated).toBe(true);
  }
}

type AppHarnessProps = {
  children: ReactNode;
  user?: User | null;
  path?: string;
  /** False for a story that brings its own data router (an error page). */
  router?: boolean;
};

/** What a screen expects around it in the app: a session, a router and the palette. */
export function AppHarness({
  children,
  user = ADA,
  path = "/",
  router = true,
}: AppHarnessProps) {
  const [client] = useState(() => (current = harnessClient(user)));
  return (
    <QueryClientProvider client={client}>
      <PlaybackProvider>
        <SearchPaletteProvider>
          {router ? (
            <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>
          ) : (
            children
          )}
        </SearchPaletteProvider>
      </PlaybackProvider>
    </QueryClientProvider>
  );
}
