import { render } from "@testing-library/react";
import type { FC } from "react";
import { describe, expect, it } from "vitest";
import { AppHarness } from "./testing/AppHarness";

type AnyStory = FC<Record<string, unknown>> & {
  args?: Record<string, unknown>;
};

function isStory(value: unknown): value is AnyStory {
  if (typeof value !== "function") return false;
  const args: unknown = Reflect.get(value, "args");
  return args === undefined || (typeof args === "object" && args !== null);
}

const modules = import.meta.glob<Record<string, unknown>>(
  "./**/*.stories.tsx",
  { eager: true },
);

const stories = Object.entries(modules).flatMap(([file, exports]) =>
  Object.entries(exports)
    .filter(([name]) => name !== "default")
    .map(([name, story]) => [`${file} ${name}`, story] as const),
);

describe("stories", () => {
  it("finds the shared components' stories", () => {
    expect(stories.length).toBeGreaterThan(0);
  });

  it.each(stories)("renders %s", (_name, story) => {
    if (!isStory(story)) throw new Error("a story export is not a component");
    const Story = story;

    const { container } = render(
      <AppHarness>
        <Story {...story.args} />
      </AppHarness>,
    );

    expect(container).not.toBeEmptyDOMElement();
  });
});
