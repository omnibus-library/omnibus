import type { ReactNode } from "react";
import { Cover } from "../../components/Cover/Cover";
import { XGlyph } from "../../components/Glyphs/Glyphs";

type SheetHeadProps = {
  /** The cover as it will read: a held one, else the book's. */
  cover: { plate: Parameters<typeof Cover>[0]["book"]; src: string | null };
  /** What the form holds now; blank reads as "Untitled" and "No author". */
  title: string;
  author: string;
  /** The Fetch metadata button, when a provider is set up to answer. */
  fetch?: ReactNode;
  onClose: () => void;
};

/** The sheet's head: the cover, the book as the form names it, Fetch metadata and Close. */
export function SheetHead({
  cover,
  title,
  author,
  fetch,
  onClose,
}: SheetHeadProps) {
  return (
    <header className="es-head">
      <div className="es-head-cover">
        <Cover book={cover.plate} src={cover.src} />
      </div>
      <div className="es-head-text">
        <h2 className="es-title" data-testid="es-title">
          {title.trim() || "Untitled"}
        </h2>
        <p className="es-author" data-testid="es-author">
          {author.trim() || "No author"}
        </p>
      </div>
      {fetch}
      <button
        type="button"
        className="es-close"
        aria-label="Close"
        data-testid="es-close"
        onClick={onClose}
      >
        <XGlyph size={20} />
      </button>
    </header>
  );
}
