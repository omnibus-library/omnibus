import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { PageError, PageNotFound } from "./PageState";

const meta = {
  title: "Components/PageState",
  component: PageError,
  args: { message: "Couldn't load the library: 500 Internal Server Error" },
} satisfies Meta<typeof PageError>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ErrorState: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("alert")).toHaveTextContent(
      "Couldn't load the library",
    );
    await expect(
      canvas.getByRole("link", { name: "Back to library" }),
    ).toHaveAttribute("href", "/");
  },
};

export const NotFoundState: Story = {
  render: () => <PageNotFound subject="Book" />,
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Book not found.")).toBeInTheDocument();
  },
};
