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

/** How a preset writes, the value it ends on, and how a failed write reads. */
type Preset<T, Write> = {
  write: Write;
  reset: T;
  label: (value: T) => string;
};

/**
 * Hands `use` a checked setter and, once it returns, puts `reset` back on every
 * owner it wrote to. A `write` that takes an owner gives the setter one too.
 */
export async function presetting<T>(
  use: (set: (value: T) => Promise<void>) => Promise<void>,
  preset: Preset<T, (value: T) => Promise<APIResponse>>,
): Promise<void>;
export async function presetting<T>(
  use: (set: (value: T, owner?: Owner) => Promise<void>) => Promise<void>,
  preset: Preset<T, (value: T, owner: Owner) => Promise<APIResponse>>,
): Promise<void>;
export async function presetting<T>(
  use: (set: (value: T, owner?: Owner) => Promise<void>) => Promise<void>,
  {
    write,
    reset,
    label,
  }: Preset<T, (value: T, owner: Owner) => Promise<APIResponse>>,
): Promise<void> {
  const touched = new Set<Owner>();
  const set = async (value: T, owner: Owner = "admin") => {
    touched.add(owner);
    await expect(await write(value, owner), label(value)).toBeOK();
  };
  await use(set);
  for (const owner of touched) await set(reset, owner);
}
