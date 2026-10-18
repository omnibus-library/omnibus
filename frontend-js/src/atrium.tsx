import { type ReactNode, useState } from "react";
import type { Book } from "./api";
import { plateAuthor } from "./format";

const THEMES = ["dark", "black", "light", "sepia"] as const;
type Theme = (typeof THEMES)[number];

function isTheme(value: unknown): value is Theme {
  return THEMES.some((theme) => theme === value);
}

// Same key the Dioxus client persists, so the two share a theme on one origin.
function savedTheme(): Theme {
  try {
    const stored = localStorage.getItem("omn.theme");
    return isTheme(stored) ? stored : "dark";
  } catch {
    return "dark";
  }
}

/** The `.atrium` wrapper every atrium.css theme token resolves against. */
export function AtriumRoot({ children }: { children: ReactNode }) {
  const [theme] = useState(savedTheme);
  return (
    <div className="atrium" data-theme={theme}>
      {children}
    </div>
  );
}

type CoverProps = {
  book: Book;
  src: string | null;
  srcSet?: string;
  sizes?: string;
};

/** A book cover, or the typeset plate when there is no image or it fails. */
export function Cover({ book, src, srcSet, sizes }: CoverProps) {
  const [broken, setBroken] = useState(false);
  const shown = src !== null && !broken;
  return (
    <div
      className="cover-wrap"
      style={book.accent ? { "--accent": book.accent } : undefined}
      data-testid="cover"
    >
      <div
        className={shown ? "cover tpl-plate ld-cover-glint" : "cover tpl-plate"}
      >
        {shown ? (
          <img
            src={src}
            srcSet={srcSet}
            sizes={sizes}
            alt={`Cover of ${book.title}`}
            loading="lazy"
            onError={() => setBroken(true)}
          />
        ) : (
          <>
            <div className="ca">{plateAuthor(book.authors)}</div>
            <div className="ct">{book.title}</div>
          </>
        )}
      </div>
    </div>
  );
}

type BusyLabelProps = { busy: boolean; label: string; busyLabel: string };

/** A button face that swaps to its busy label without changing width. */
export function BusyLabel({ busy, label, busyLabel }: BusyLabelProps) {
  return (
    <span className="ld-busy" data-sizer={busyLabel}>
      <span className="ld-busy-face">
        {busy && <span className="ld-ring xs" aria-hidden="true" />}
        <span>{busy ? busyLabel : label}</span>
      </span>
    </span>
  );
}

const LEAVES = [0, 1, 2];

/** The full-page riffle loader that fills `main` while a route loads. */
export function PageLoader({ label }: { label: string }) {
  return (
    <div className="ld ld-page" role="status" aria-live="polite">
      <span className="ld-riffle lg" aria-hidden="true">
        <span className="ld-rf-book">
          <span className="ld-rf-page l" />
          <span className="ld-rf-page r" />
          {LEAVES.map((n) => (
            <span key={n} className={`ld-rf-leaf n${n}`} style={{ "--i": n }}>
              <span className="ld-rf-face front" />
              <span className="ld-rf-face back" />
            </span>
          ))}
        </span>
      </span>
      <p className="ld-label">{label}</p>
    </div>
  );
}
