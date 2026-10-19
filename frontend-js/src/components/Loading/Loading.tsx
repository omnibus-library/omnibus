import type { CSSProperties, ReactNode } from "react";
import { classes } from "../../classes";
import "./Loading.css";

/** The shape a wait fills: pick by where it sits, not by how long it takes. */
export type LoadingKind = "page" | "stage" | "sheet" | "section" | "row";
export type LoadingMark = "auto" | "riffle" | "line" | "ring";
export type MarkSize = "xs" | "sm" | "md" | "lg" | "xl";

const KIND_CLASS = {
  page: "ld-page",
  stage: "ld-stage",
  sheet: "ld-sheet",
  section: "ld-section",
  row: "ld-row",
} satisfies Record<LoadingKind, string>;

const SIZE_CLASS = {
  xs: "xs",
  sm: "sm",
  md: null,
  lg: "lg",
  xl: "xl",
} satisfies Record<MarkSize, string | null>;

const LINE_FOR_KIND = {
  page: { ticks: 14, size: "md" },
  stage: { ticks: 32, size: "xl" },
  sheet: { ticks: 20, size: "lg" },
  section: { ticks: 14, size: "md" },
  row: { ticks: 10, size: "sm" },
} satisfies Record<LoadingKind, { ticks: number; size: MarkSize }>;

const AMPLITUDES = [
  0.62, 0.88, 0.7, 1.0, 0.78, 0.55, 0.92, 0.66, 0.84, 0.58, 0.96, 0.72, 0.6,
  0.9, 0.68, 0.8,
];

const LEAVES = ["n0", "n1", "n2"] as const;

type RingProps = { size?: MarkSize; className?: string };

/** The spinning ring: a row, a busy button. */
export function Ring({ size = "sm", className }: RingProps) {
  // The ring names its middle size; the line and the riffle leave it bare.
  const sizeClass = size === "md" ? "md" : SIZE_CLASS[size];
  return (
    <span
      className={classes("ld-ring", sizeClass, className)}
      aria-hidden="true"
    />
  );
}

/** The breathing tick line: sections, sheets and the audio stage. */
export function Line({
  ticks = 16,
  size = "md",
}: {
  ticks?: number;
  size?: MarkSize;
}) {
  return (
    <span
      className={classes("ld-line", SIZE_CLASS[size])}
      style={{ "--n": ticks }}
      aria-hidden="true"
    >
      {[...Array(ticks).keys()].map((i) => (
        <i
          key={i}
          style={{ "--i": i, "--a": AMPLITUDES[i % AMPLITUDES.length] }}
        />
      ))}
    </span>
  );
}

/** The open book turning its leaves: pages and reader stages. */
export function Riffle({ size = "md" }: { size?: MarkSize }) {
  return (
    <span className={classes("ld-riffle", SIZE_CLASS[size])} aria-hidden="true">
      <span className="ld-rf-book">
        <span className="ld-rf-page l" />
        <span className="ld-rf-page r" />
        {LEAVES.map((leaf, i) => (
          <span
            key={leaf}
            className={`ld-rf-leaf ${leaf}`}
            style={{ "--i": i }}
          >
            <span className="ld-rf-face front" />
            <span className="ld-rf-face back" />
          </span>
        ))}
      </span>
    </span>
  );
}

function resolveMark(kind: LoadingKind, mark: LoadingMark) {
  if (mark !== "auto") return mark;
  if (kind === "page" || kind === "stage") return "riffle";
  return kind === "row" ? "ring" : "line";
}

function Mark({ kind, mark }: { kind: LoadingKind; mark: LoadingMark }) {
  const resolved = resolveMark(kind, mark);
  switch (resolved) {
    case "riffle":
      return (
        <Riffle size={kind === "page" || kind === "stage" ? "lg" : "md"} />
      );
    case "line":
      return <Line {...LINE_FOR_KIND[kind]} />;
    case "ring":
      return <Ring size={kind === "stage" ? "lg" : "sm"} />;
    default: {
      const _exhaustive: never = resolved;
      return _exhaustive;
    }
  }
}

type LoadingProps = {
  kind?: LoadingKind;
  mark?: LoadingMark;
  label?: string;
  title?: string;
  className?: string;
  testId?: string;
  children?: ReactNode;
};

/** Every wait in the app: a mark, a caption, and a slot for a retry. */
export function Loading({
  kind = "section",
  mark = "auto",
  label = "Loading…",
  title,
  className,
  testId,
  children,
}: LoadingProps) {
  return (
    <div
      className={classes("ld", KIND_CLASS[kind], className)}
      data-testid={testId}
      role="status"
      aria-live="polite"
    >
      <Mark kind={kind} mark={mark} />
      {title && <p className="ld-stage-title">{title}</p>}
      <p className="ld-label">{label}</p>
      <div className="ld-slot">{children}</div>
    </div>
  );
}

type BusyLabelProps = { busy: boolean; label: string; busyLabel: string };

/** A button face that swaps to its busy label without changing width. */
export function BusyLabel({ busy, label, busyLabel }: BusyLabelProps) {
  return (
    <span className="ld-busy" data-sizer={busyLabel}>
      <span className="ld-busy-face">
        {busy && <Ring size="xs" />}
        <span>{busy ? busyLabel : label}</span>
      </span>
    </span>
  );
}

export type SkeletonShape = "line" | "block" | "circle" | "cover";

type SkeletonProps = {
  shape?: SkeletonShape;
  index?: number;
  style?: CSSProperties;
};

/** One placeholder plate, staggered by `index`. */
export function Skeleton({ shape = "line", index = 0, style }: SkeletonProps) {
  return (
    <span
      className={`ld-skel ${shape}`}
      style={{ "--i": index, ...style }}
      aria-hidden="true"
    />
  );
}

/** A grid of cover-plus-caption placeholders where a cover grid will land. */
export function CoverSkeletons({ count = 12 }: { count?: number }) {
  return (
    <div className="ld-covers" aria-hidden="true">
      {[...Array(count).keys()].map((i) => (
        <div key={i} className="ld-covers-cell">
          <Skeleton shape="cover" index={i} />
          <Skeleton index={i} />
          <Skeleton index={i} />
        </div>
      ))}
    </div>
  );
}

/** Placeholder list rows, with an avatar circle unless `avatar` is false. */
export function RowSkeletons({
  count = 4,
  avatar = true,
}: {
  count?: number;
  avatar?: boolean;
}) {
  return (
    <div
      className="ld-rows"
      style={{ "--row-cols": avatar ? "36px 1fr auto" : "1fr auto" }}
      aria-hidden="true"
    >
      {[...Array(count).keys()].map((i) => (
        <div key={i} className="ld-rows-row">
          {avatar && <Skeleton shape="circle" index={i} />}
          <div className="ld-rows-text">
            <Skeleton index={i} style={{ "--w": `${58 + ((i * 37) % 30)}%` }} />
            <Skeleton
              index={i}
              style={{ "--w": `${28 + ((i * 23) % 25)}%`, height: ".7em" }}
            />
          </div>
          <Skeleton index={i} style={{ "--w": "48px" }} />
        </div>
      ))}
    </div>
  );
}

type StaleProps = { stale: boolean; className?: string; children: ReactNode };

/** Keeps content on screen, dimmed, while it refetches. */
export function Stale({ stale, className, children }: StaleProps) {
  return (
    <div
      className={classes("ld-stale", stale && "is-stale", className)}
      aria-busy={stale}
    >
      {children}
    </div>
  );
}
