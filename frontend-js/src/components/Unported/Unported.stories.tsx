import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, waitFor } from "storybook/test";
import { ButtonLink } from "../Button/Button";
import { Unported } from "./Unported";

const meta = {
  title: "Components/Unported",
  component: Unported,
  args: { title: "Authors", source: "frontend/src/pages/authors_index.rs" },
} satisfies Meta<typeof Unported>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Plain: Story = {
  play: async ({ canvas }) => {
    await expect(
      canvas.getByText("frontend/src/pages/authors_index.rs"),
    ).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe("Omnibus | Authors"));
  },
};

export const WithParams: Story = {
  args: {
    title: "PDF reader",
    source: "frontend/src/pages/pdf_reader/",
    params: {
      uuid: "ec8495e8-0ce8-4cb1-8c1d-b646b0a717e0",
      page: "7",
      file_id: null,
    },
    children: <ButtonLink to="/">Back to the book</ButtonLink>,
  },
  play: async ({ canvas }) => {
    await expect(
      canvas.getByText("file_id").nextElementSibling,
    ).toHaveTextContent("—");
  },
};
