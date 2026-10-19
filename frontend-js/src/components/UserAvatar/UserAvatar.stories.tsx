import type { Meta, StoryObj } from "@storybook/react-vite";
import { HttpResponse, http } from "msw";
import { expect } from "storybook/test";
import { toUser } from "../../api";
import { ADA } from "../../testing/AppHarness";
import { COVER_SVG } from "../../testing/books";
import { WIRE_ADA } from "../../testing/wire";
import { UserAvatar } from "./UserAvatar";

const meta = {
  title: "Components/UserAvatar",
  component: UserAvatar,
  args: {
    user: ADA,
    className: "um-initials",
    photoClassName: "um-initials-photo",
  },
} satisfies Meta<typeof UserAvatar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Monogram: Story = {
  play: async ({ canvasElement }) => {
    await expect(canvasElement).toHaveTextContent("AL");
  },
};

export const Photo: Story = {
  args: { user: { ...ADA, hasAvatar: true } },
  beforeEach({ msw }) {
    msw.use(
      http.get(
        "/api/users/1/avatar",
        () =>
          new HttpResponse(COVER_SVG, {
            headers: { "Content-Type": "image/svg+xml" },
          }),
      ),
    );
  },
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("img", { name: "Ada Lovelace" }),
    ).toHaveAttribute("src", "/api/users/1/avatar");
  },
};

// Another user, so the browser can't answer from the Photo story's cached image.
export const BrokenPhoto: Story = {
  args: { user: toUser({ ...WIRE_ADA, id: 2, has_avatar: true }) },
  beforeEach({ msw }) {
    msw.use(
      http.get(
        "/api/users/2/avatar",
        () => new HttpResponse(null, { status: 404 }),
      ),
    );
  },
  play: async ({ canvas, canvasElement }) => {
    await expect(await canvas.findByText("AL")).toBeInTheDocument();
    await expect(canvasElement.querySelector("img")).toBeNull();
  },
};
