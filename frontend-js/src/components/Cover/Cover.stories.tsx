import type { Story, StoryDefault } from "@ladle/react";
import type { ReactNode } from "react";
import { aBook, COVER_ART } from "../../testing/books";
import { Cover } from "./Cover";

export default { title: "Components / Cover" } satisfies StoryDefault;

function Frame({ children }: { children: ReactNode }) {
  return <div style={{ width: 200 }}>{children}</div>;
}

export const WithImage: Story = () => (
  <Frame>
    <Cover book={aBook()} src={COVER_ART} />
  </Frame>
);

export const Plate: Story = () => (
  <Frame>
    <Cover book={aBook({ hasCover: false })} src={null} />
  </Frame>
);

export const PlateWithoutAccent: Story = () => (
  <Frame>
    <Cover
      book={aBook({
        accent: null,
        title: "Desert Protocols",
        authors: ["Vint Cerf"],
      })}
      src={null}
    />
  </Frame>
);

export const BrokenImage: Story = () => (
  <Frame>
    <Cover book={aBook()} src="/no/such/cover.png" />
  </Frame>
);
