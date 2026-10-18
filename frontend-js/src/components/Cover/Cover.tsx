import { useState } from "react";
import type { Book } from "../../api";
import { plateAuthor } from "../../format";
import "./Cover.css";

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
