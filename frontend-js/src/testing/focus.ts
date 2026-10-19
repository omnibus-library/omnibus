import { focusManager, type QueryClient } from "@tanstack/react-query";
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

/** Hands focus back to the document, as a test that called `returnToTab` must. */
export const resetFocus = () => focusManager.setFocused(undefined);
