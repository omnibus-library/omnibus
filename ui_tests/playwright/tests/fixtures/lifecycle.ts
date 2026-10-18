import type { APIResponse } from "@playwright/test";
import { expect } from "./test";

/** Whose account an account-level fixture writes to: the suite admin's or the worker's reader. */
export type Owner = "admin" | "reader";

/** Hands `use` an empty set and, once it returns, undoes each member the test collected. */
export async function cleanupSet<T>(
  use: (items: Set<T>) => Promise<void>,
  undo: (item: T) => Promise<APIResponse>,
  label: (item: T) => string,
): Promise<void> {
  const items = new Set<T>();
  await use(items);
  for (const item of items) {
    await expect(await undo(item), label(item)).toBeOK();
  }
}

/** Hands `use` a checked setter and, once it returns, puts `reset` back on every owner it wrote to. */
export async function presetting<T>(
  use: (set: (value: T, owner?: Owner) => Promise<void>) => Promise<void>,
  write: (value: T, owner: Owner) => Promise<APIResponse>,
  reset: T,
  label: (value: T) => string,
): Promise<void> {
  const touched = new Set<Owner>();
  const set = async (value: T, owner: Owner = "admin") => {
    touched.add(owner);
    await expect(await write(value, owner), label(value)).toBeOK();
  };
  await use(set);
  for (const owner of touched) await set(reset, owner);
}
