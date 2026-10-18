import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { ADA } from "../../testing/AppHarness";
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
      canvas.getByRole("link", { name: "Ada Lovelace" }),
    ).toHaveAttribute("href", "/account");
    await expect(
      canvas.getByRole("link", { name: "Add books" }),
    ).toBeInTheDocument();
  },
};

export const WithoutUploadAccess: Story = {
  parameters: { user: { ...ADA, canUpload: false } },
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
