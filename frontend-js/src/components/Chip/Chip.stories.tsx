import type { Story, StoryDefault } from "@ladle/react";
import { Chip } from "./Chip";

export default { title: "Components / Chip" } satisfies StoryDefault;

const ROW = { display: "flex", gap: 8, listStyle: "none" } as const;

export const Plain: Story = () => (
  <ul style={ROW}>
    <Chip>Space opera</Chip>
    <Chip>First contact</Chip>
  </ul>
);

export const Genre: Story = () => (
  <ul style={ROW}>
    <Chip tone="genre">Science fiction</Chip>
    <Chip tone="genre">Adventure</Chip>
  </ul>
);
