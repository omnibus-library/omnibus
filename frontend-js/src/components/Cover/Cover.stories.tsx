import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect } from "storybook/test";
import { aBook, COVER_ART } from "../../testing/books";
import { Cover } from "./Cover";

const meta = {
  title: "Components/Cover",
  component: Cover,
  args: { book: aBook(), src: COVER_ART },
  decorators: [
    (Story) => (
      <div style={{ width: 200 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Cover>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithImage: Story = {
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("img", { name: "Cover of Aurora Station, Vol. 1" }),
    ).toHaveAttribute("src", COVER_ART);
  },
};

export const Plate: Story = {
  args: { book: aBook({ hasCover: false }), src: null },
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole("img")).not.toBeInTheDocument();
    await expect(canvas.getByText("INKWELL")).toBeInTheDocument();
  },
};

export const PlateWithoutAccent: Story = {
  args: {
    book: aBook({
      accent: null,
      title: "Desert Protocols",
      authors: ["Vint Cerf"],
    }),
    src: null,
  },
};

export const BrokenImage: Story = {
  args: { src: "/no/such/cover.png" },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("Aurora Station, Vol. 1"),
    ).toBeInTheDocument();
    await expect(canvas.queryByRole("img")).not.toBeInTheDocument();
  },
};

export const RecoversWhenTheAddressChanges: Story = {
  args: { src: "/no/such/cover.png" },
  render: (args) => {
    const [src, setSrc] = useState(args.src);
    return (
      <>
        <Cover {...args} src={src} />
        <button type="button" onClick={() => setSrc(COVER_ART)}>
          Use another image
        </button>
      </>
    );
  },
  play: async ({ canvas, userEvent }) => {
    await expect(
      await canvas.findByText("Aurora Station, Vol. 1"),
    ).toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button"));

    await expect(await canvas.findByRole("img")).toHaveAttribute(
      "src",
      COVER_ART,
    );
  },
};
