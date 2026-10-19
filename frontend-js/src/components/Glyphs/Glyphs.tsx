// Atrium's line icons, drawn in the current text colour and hidden from the
// accessibility tree: the control around each one carries the name.

type GlyphProps = { size?: number };

const stroked = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

/** A filled play triangle, for "continue listening". */
export function PlayGlyph({ size = 14 }: GlyphProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 15 15"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M4 2.5v10l8-5z" />
    </svg>
  );
}

/** An open book, for "continue reading". */
export function BookGlyph({ size = 14 }: GlyphProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      {...stroked}
      aria-hidden="true"
    >
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  );
}

/** Three sliders, for personal settings. */
export function SlidersGlyph({ size = 16 }: GlyphProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      {...stroked}
      aria-hidden="true"
    >
      <path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" />
      <circle cx="15" cy="6" r="2" />
      <circle cx="9" cy="12" r="2" />
      <circle cx="17" cy="18" r="2" />
    </svg>
  );
}

/** Two stacked server units, for administration. */
export function ServerGlyph({ size = 16 }: GlyphProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      {...stroked}
      aria-hidden="true"
    >
      <rect x="3" y="4" width="18" height="7" rx="2" />
      <rect x="3" y="13" width="18" height="7" rx="2" />
      <path d="M7 7.5h.01M7 16.5h.01" />
    </svg>
  );
}

/** A magnifying glass, for search. */
export function SearchGlyph({
  size = 15,
  className,
}: GlyphProps & { className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      {...stroked}
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

/** Headphones, for an audiobook. */
export function HeadphonesGlyph({ size = 15 }: GlyphProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.35}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 10V8.5a5 5 0 0 1 10 0V10" />
      <path
        d="M2.75 10h2.5v3.75h-1.5a1 1 0 0 1-1-1zM13.25 10h-2.5v3.75h1.5a1 1 0 0 0 1-1z"
        fill="currentColor"
      />
    </svg>
  );
}

/** A book beside a soundwave, for reading and listening together. */
export function ImmersiveGlyph({ size = 17 }: GlyphProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 5.2A2 2 0 0 1 6 4h4.2a1.8 1.8 0 0 1 1.8 1.8V18a1.6 1.6 0 0 0-1.6-1.6H6A2 2 0 0 1 4 14.4V5.2z" />
      <path d="M15.5 8v8M18.5 6v12M21 9.5v5" />
    </svg>
  );
}

/** Two sparkles, for an action that fetches something about a book from outside the library. */
export function SparkleGlyph({ size = 16 }: GlyphProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3l1.7 4.8L18.5 9.5l-4.8 1.7L12 16l-1.7-4.8L5.5 9.5l4.8-1.7z" />
      <path d="M18.5 14.5l.85 2.15L21.5 17.5l-2.15.85L18.5 20.5l-.85-2.15L15.5 17.5l2.15-.85z" />
    </svg>
  );
}

/** A tray with a down arrow, for a download. */
export function DownloadGlyph({ size = 15 }: GlyphProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3v12" />
      <path d="m7 12 5 5 5-5" />
      <path d="M4 21h16" />
    </svg>
  );
}

/** Two stacked sheets, for a copy. */
export function CopyGlyph({ size = 15 }: GlyphProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}
