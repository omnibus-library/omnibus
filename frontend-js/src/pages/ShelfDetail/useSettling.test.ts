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
  it("holds until the work handed to settle has finished", async () => {
    const { result } = renderHook(() => useSettling());
    const first = held();

    expect(result.current[0]).toBe(false);
    act(() => result.current[1](first.work));
    expect(result.current[0]).toBe(true);

    await act(async () => first.release());
    await waitFor(() => expect(result.current[0]).toBe(false));
  });

  it("holds until every overlapping piece of work has finished", async () => {
    const { result } = renderHook(() => useSettling());
    const first = held();
    const second = held();

    act(() => result.current[1](first.work));
    act(() => result.current[1](second.work));
    await act(async () => first.release());
    expect(result.current[0]).toBe(true);

    await act(async () => second.release());
    await waitFor(() => expect(result.current[0]).toBe(false));
  });

  it("releases when the work fails", async () => {
    const { result } = renderHook(() => useSettling());
    const failing = Promise.reject(new Error("offline"));
    failing.catch(() => {});

    act(() => result.current[1](failing));

    await waitFor(() => expect(result.current[0]).toBe(false));
  });
});
