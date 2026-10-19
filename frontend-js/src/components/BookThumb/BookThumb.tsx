import { useState } from "react";
import { type PaletteBook, thumbUrl } from "../../api";
import { initialOf } from "../../format";

type BookThumbProps = {
  book: PaletteBook;
  size: "sm" | "md";
  /** Spelled out at each site so the Atrium extractor finds the rules. */
  className: string;
  fallbackClassName: string;
};

/** A search hit's thumbnail, or its accent plate when it has none or it fails. */
export function BookThumb({
  book,
  size,
  className,
  fallbackClassName,
}: BookThumbProps) {
  const [broken, setBroken] = useState(false);
  if (book.hasCover && !broken) {
    return (
      <img
        className={className}
        src={thumbUrl(book.uuid, size)}
        alt=""
        loading="lazy"
        onError={() => setBroken(true)}
      />
    );
  }
  return (
    <div
      className={fallbackClassName}
      style={{ background: book.accent ?? "var(--bg-2)" }}
    >
      {initialOf(book.title)}
    </div>
  );
}
