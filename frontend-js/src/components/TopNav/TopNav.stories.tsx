import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { WIRE_ADA } from "../../testing/wire";
import { TopNav } from "./TopNav";

const meta = {
  title: "Components/TopNav",
  component: TopNav,
} satisfies Meta<typeof TopNav>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SignedIn: Story = {
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("button", { name: "Open user menu" }),
    ).toHaveTextContent("AL");
    await expect(
      canvas.getByRole("link", { name: "Add books" }),
    ).toBeInTheDocument();
  },
};

export const WithoutUploadAccess: Story = {
  parameters: { user: { ...WIRE_ADA, can_upload: false } },
  play: async ({ canvas }) => {
    await expect(
      canvas.queryByRole("link", { name: "Add books" }),
    ).not.toBeInTheDocument();
  },
};

export const InASection: Story = {
  parameters: { path: "/authors/12" },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("link", { name: "Authors" })).toHaveClass(
      "on",
    );
    await expect(canvas.getByRole("link", { name: "Library" })).not.toHaveClass(
      "on",
    );
  },
};
