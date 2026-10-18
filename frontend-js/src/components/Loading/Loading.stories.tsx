import type { Story, StoryDefault } from "@ladle/react";
import type { ReactNode } from "react";
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

export default { title: "Components / Loading" } satisfies StoryDefault;

// The stage covers a reader, so it gets a story of its own.
const KINDS: LoadingKind[] = ["page", "sheet", "section", "row"];
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

export const Kinds: Story = () => (
  <div style={{ display: "grid", gap: 24 }}>
    {KINDS.map((kind) => (
      <Box key={kind} label={kind}>
        <Loading kind={kind} label={`Loading the ${kind}`} />
      </Box>
    ))}
  </div>
);

export const StageWithRetry: Story = () => (
  <Box label="stage" height={360}>
    <Loading kind="stage" title="The Seamful Suite" label="Opening the audio">
      <Button size="sm">Try again</Button>
    </Loading>
  </Box>
);

export const Marks: Story = () => (
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
);

type BusyProps = { busy: boolean };

export const Busy: Story<BusyProps> = ({ busy }) => (
  <Button variant="primary" disabled={busy} aria-busy={busy}>
    <BusyLabel busy={busy} label="Save" busyLabel="Saving…" />
  </Button>
);
Busy.args = { busy: true };

export const Skeletons: Story = () => (
  <div style={{ display: "flex", gap: 24, alignItems: "end" }}>
    {SHAPES.map((shape, index) => (
      <Box key={shape} label={shape}>
        <div style={{ width: 120, padding: 8 }}>
          <Skeleton shape={shape} index={index} />
        </div>
      </Box>
    ))}
  </div>
);

export const CoverGrid: Story = () => <CoverSkeletons count={8} />;

export const Rows: Story = () => <RowSkeletons count={4} />;

export const RowsWithoutAvatar: Story = () => (
  <RowSkeletons count={3} avatar={false} />
);

export const StaleContent: Story<BusyProps> = ({ busy }) => (
  <Stale stale={busy}>
    <p>Content stays on screen, dimmed, while it refetches.</p>
  </Stale>
);
StaleContent.args = { busy: true };
