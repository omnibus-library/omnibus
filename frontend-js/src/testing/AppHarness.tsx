import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { MemoryRouter } from "react-router";
import type { User } from "../api";
import { meQuery } from "../session";

/** The signed-in reader stories and tests render as. */
export const ADA: User = { name: "Ada Lovelace", canUpload: true };

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

type AppHarnessProps = {
  children: ReactNode;
  user?: User | null;
  path?: string;
  /** False for a story that brings its own data router (an error page). */
  router?: boolean;
};

/** What a screen expects around it in the app: a session and a router. */
export function AppHarness({
  children,
  user = ADA,
  path = "/",
  router = true,
}: AppHarnessProps) {
  const [client] = useState(() => harnessClient(user));
  return (
    <QueryClientProvider client={client}>
      {router ? (
        <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>
      ) : (
        children
      )}
    </QueryClientProvider>
  );
}
