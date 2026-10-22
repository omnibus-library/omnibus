import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBookTabs } from "./BookTabs";

describe("useBookTabs", () => {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    document.documentElement.style.removeProperty("--dir");
  });

  it("ends on the tab asked for last, even when two are asked for before the page turns", () => {
    const { result } = renderHook(() => useBookTabs());
    const { selectTab } = result.current;

    act(() => {
      void selectTab("files");
      void selectTab("overview");
    });

    expect(result.current.tab).toBe("overview");
  });

  it("turns toward the tab asked for from the one last asked for", () => {
    const { result } = renderHook(() => useBookTabs());
    const { selectTab } = result.current;

    act(() => {
      void selectTab("files");
      void selectTab("reviews");
    });

    // Reviews sits before Files, though the page still shows Overview.
    expect(document.documentElement.style.getPropertyValue("--dir")).toBe("-1");
  });
});
