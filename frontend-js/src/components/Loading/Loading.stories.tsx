import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import { expect } from "storybook/test";
import { Button } from "../Button/Button";
import {
  BusyLabel,
  CoverSkeletons,
  Line,
  Loading,
  type LoadingKind,
  type MarkSize,
  Riffle,
  Ring,
  RowSkeletons,
  Skeleton,
  type SkeletonShape,
  Stale,
} from "./Loading";

const SIZES: MarkSize[] = ["xs", "sm", "md", "lg", "xl"];
const SHAPES: SkeletonShape[] = ["line", "block", "circle", "cover"];

type BoxProps = { label: string; height?: number; children: ReactNode };

// Positioned, because the stage loader covers its nearest positioned ancestor.
function Box({ label, height, children }: BoxProps) {
  return (
    <figure style={{ display: "grid", gap: 8, margin: 0 }}>
      <figcaption className="label">{label}</figcaption>
      <div
        style={{
          position: "relative",
          border: "1px dashed var(--line)",
          minHeight: 120,
          height,
        }}
      >
        {children}
      </div>
    </figure>
  );
}

const meta = {
  title: "Components/Loading",
  component: Loading,
  args: { kind: "section", label: "Loading the shelves" },
  argTypes: {
    kind: {
      control: "select",
      options: ["page", "sheet", "section", "row"] satisfies LoadingKind[],
    },
  },
} satisfies Meta<typeof Loading>;

export default meta;
type Story = StoryObj<typeof meta>;

function marks(mark: string): Story["play"] {
  return async ({ canvas }) => {
    const status = canvas.getByRole("status");
    await expect(status).toHaveTextContent("Loading the shelves");
    await expect(status.querySelector(`.${mark}`)).not.toBeNull();
  };
}

export const Page: Story = { args: { kind: "page" }, play: marks("ld-riffle") };
export const Sheet: Story = { args: { kind: "sheet" }, play: marks("ld-line") };
export const Section: Story = { play: marks("ld-line") };
export const Row: Story = { args: { kind: "row" }, play: marks("ld-ring") };

export const Stage: Story = {
  render: () => (
    <Box label="stage" height={360}>
      <Loading kind="stage" title="The Seamful Suite" label="Opening the audio">
        <Button size="sm">Try again</Button>
      </Loading>
    </Box>
  ),
  play: async ({ canvas }) => {
    const status = canvas.getByRole("status");
    await expect(status.querySelector(".ld-riffle")).not.toBeNull();
    await expect(
      canvas.getByRole("button", { name: "Try again" }),
    ).toBeInTheDocument();
  },
};

export const Marks: Story = {
  render: () => (
    <div style={{ display: "grid", gap: 24 }}>
      {SIZES.map((size) => (
        <div
          key={size}
          style={{ display: "flex", gap: 32, alignItems: "center" }}
        >
          <span className="label" style={{ width: 24 }}>
            {size}
          </span>
          <Ring size={size} />
          <Line size={size} />
          <Riffle size={size} />
        </div>
      ))}
    </div>
  ),
};

export const BusyButton: Story = {
  render: () => (
    <Button variant="primary" disabled aria-busy>
      <BusyLabel busy label="Save" busyLabel="Saving…" />
    </Button>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("button")).toHaveTextContent("Saving…");
  },
};

export const IdleButton: Story = {
  render: () => (
    <Button variant="primary">
      <BusyLabel busy={false} label="Save" busyLabel="Saving…" />
    </Button>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("button")).toHaveTextContent("Save");
  },
};

export const Skeletons: Story = {
  render: () => (
    <div style={{ display: "flex", gap: 24, alignItems: "end" }}>
      {SHAPES.map((shape, index) => (
        <Box key={shape} label={shape}>
          <div style={{ width: 120, padding: 8 }}>
            <Skeleton shape={shape} index={index} />
          </div>
        </Box>
      ))}
    </div>
  ),
};

export const CoverGrid: Story = {
  render: () => <CoverSkeletons count={8} />,
  play: async ({ canvasElement }) => {
    await expect(
      canvasElement.querySelectorAll(".ld-covers-cell"),
    ).toHaveLength(8);
  },
};

export const Rows: Story = { render: () => <RowSkeletons count={4} /> };

export const RowsWithoutAvatar: Story = {
  render: () => <RowSkeletons count={3} avatar={false} />,
};

export const StaleContent: Story = {
  render: () => (
    <Stale stale>
      <p>Content stays on screen, dimmed, while it refetches.</p>
    </Stale>
  ),
  play: async ({ canvas }) => {
    await expect(
      canvas.getByText(/Content stays on screen/).parentElement,
    ).toHaveAttribute("aria-busy", "true");
  },
};
