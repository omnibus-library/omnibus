import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { Button } from "../Button/Button";
import { Banner, type BannerKind } from "./Banner";

const KINDS: BannerKind[] = ["err", "warn", "info", "ok"];

const meta = {
  title: "Components/Banner",
  component: Banner,
  args: { kind: "err", title: "Wrong username or password." },
  argTypes: { kind: { control: "inline-radio", options: KINDS } },
  decorators: [
    (Story) => (
      <div style={{ maxWidth: 420 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Banner>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ErrorBanner: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("alert")).toHaveTextContent(
      "Wrong username or password.",
    );
  },
};

export const Kinds: Story = {
  render: () => (
    <div style={{ display: "grid", gap: 12 }}>
      {KINDS.map((kind) => (
        <Banner key={kind} kind={kind} title={`A ${kind} banner`} />
      ))}
    </div>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("alert")).toHaveTextContent("A err banner");
    await expect(canvas.getAllByRole("status")).toHaveLength(3);
  },
};

export const WithMessage: Story = {
  args: {
    kind: "warn",
    title: "Registration is closed",
    message: "Ask an admin for an account.",
  },
  play: async ({ canvas }) => {
    await expect(
      canvas.getByText("Ask an admin for an account."),
    ).toBeInTheDocument();
  },
};

export const WithAction: Story = {
  args: {
    title: "Couldn't reach the server",
    children: <Button size="sm">Try again</Button>,
  },
  play: async ({ canvas }) => {
    await expect(
      canvas.getByRole("button", { name: "Try again" }),
    ).toBeInTheDocument();
  },
};
