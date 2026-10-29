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
  /** A write is in flight that closing could not stop. */
  closeDisabled?: boolean;
  onClose: () => void;
};

/** The sheet's Close, in the head of every step. */
export function CloseButton({
  disabled = false,
  onClose,
}: {
  disabled?: boolean;
  onClose: () => void;
}) {
  return (
    <button
      type="button"
      className="es-close"
      aria-label="Close"
      data-testid="es-close"
      disabled={disabled}
      onClick={onClose}
    >
      <XGlyph size={20} />
    </button>
  );
}

/** The sheet's head: the cover, the book as the form names it, Fetch metadata and Close. */
export function SheetHead({
  cover,
  title,
  author,
  fetch,
  closeDisabled,
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
      <CloseButton disabled={closeDisabled} onClose={onClose} />
    </header>
  );
}
