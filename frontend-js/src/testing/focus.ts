import {
  focusManager,
  onlineManager,
  type QueryClient,
} from "@tanstack/react-query";
import { act, waitFor } from "@testing-library/react";
import { expect } from "vitest";

/** A trip to another tab and back, then every refetch that return started has settled. */
export async function returnToTab(client: QueryClient) {
  await act(async () => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
  });
  await waitFor(() => expect(client.isFetching()).toBe(0));
}

/** The connection dropping and coming back, then every refetch that return started has settled. */
export async function reconnect(client: QueryClient) {
  await act(async () => {
    onlineManager.setOnline(false);
    onlineManager.setOnline(true);
  });
  await waitFor(() => expect(client.isFetching()).toBe(0));
}
