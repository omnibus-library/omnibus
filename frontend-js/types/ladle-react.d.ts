// shortcut: @ladle/react 5.1.1 publishes .tsx sources as its typings, which
// fail against React 19's types and which skipLibCheck can't skip. This is the
// slice of its API the stories use; drop it once Ladle ships plain .d.ts.
import type { FC, ReactNode } from "react";

type Control = {
  type: "select" | "radio" | "check" | "text" | "number" | "boolean";
};

export type ArgTypes<P> = {
  [K in keyof P]?: { options?: readonly P[K][]; control?: Control };
};

export interface Story<P = object> extends FC<P> {
  args?: Partial<P>;
  argTypes?: ArgTypes<P>;
}

export interface StoryDefault {
  title?: string;
}

export type GlobalProvider = FC<{
  globalState: { theme: "light" | "dark" | "auto" };
  children: ReactNode;
}>;

export type UserConfig = Record<string, unknown>;
