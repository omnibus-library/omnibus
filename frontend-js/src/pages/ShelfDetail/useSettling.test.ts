import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useSettling } from "./useSettling";

const held = () => {
  let release = () => {};
  const work = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { work, release };
};

describe("useSettling", () => {
  it("holds the shelf until the work handed to settle has finished", async () => {
    const { result } = renderHook(() => useSettling(7));
    const add = held();

    expect(result.current[0]).toBe(false);
    act(() => result.current[1](7, add.work));
    expect(result.current[0]).toBe(true);

    await act(async () => add.release());
    await waitFor(() => expect(result.current[0]).toBe(false));
  });

  it("holds nothing on another shelf than the one the add was for", () => {
    const { result, rerender } = renderHook(({ id }) => useSettling(id), {
      initialProps: { id: 7 },
    });

    act(() => result.current[1](7, held().work));
    rerender({ id: 8 });

    expect(result.current[0]).toBe(false);
  });

  it("releases when the work fails", async () => {
    const { result } = renderHook(() => useSettling(7));
    const failing = Promise.reject(new Error("offline"));
    failing.catch(() => {});

    act(() => result.current[1](7, failing));

    await waitFor(() => expect(result.current[0]).toBe(false));
  });
});
