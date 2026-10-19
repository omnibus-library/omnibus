import { Fragment } from "react";
import { Link } from "react-router";
import { formatYear, initialOf, plural } from "../../format";
import { settingsPlace } from "../../settingsIndex";
import { BookThumb } from "../BookThumb/BookThumb";
import { ServerGlyph, SlidersGlyph } from "../Glyphs/Glyphs";
import {
  itemHref,
  itemKey,
  type PaletteGroup,
  type PaletteItem,
} from "./selection";

const books = (n: number) => `${n} book${plural(n)}`;

const TEST_IDS: Record<PaletteItem["kind"], string> = {
  book: "sp-book-row",
  author: "sp-author-row",
  series: "sp-series-row",
  tag: "sp-tag-row",
  genre: "sp-genre-row",
  setting: "sp-setting-row",
};

type ResultsListProps = {
  groups: readonly PaletteGroup[];
  highlighted: string | null;
  onPick: () => void;
};

/** The grouped rows, in the order the arrow keys walk them. */
export function ResultsList({ groups, highlighted, onPick }: ResultsListProps) {
  return (
    <div className="sp-results">
      {groups.map((group) => (
        <Fragment key={group.label}>
          <div className="sp-group-head label">
            {group.label} · {group.items.length}
          </div>
          {group.items.map((item) => {
            const key = itemKey(item);
            return (
              <Link
                key={key}
                to={itemHref(item)}
                className={key === highlighted ? "sp-row selected" : "sp-row"}
                data-testid={TEST_IDS[item.kind]}
                onClick={onPick}
              >
                <RowContent item={item} />
              </Link>
            );
          })}
        </Fragment>
      ))}
    </div>
  );
}

function RowContent({ item }: { item: PaletteItem }) {
  switch (item.kind) {
    case "book": {
      const { hit } = item;
      const year = hit.year ? formatYear(hit.year) : null;
      const formats = hit.formats.join(" · ");
      return (
        <>
          <BookThumb
            book={hit}
            size="sm"
            className="sp-row-cover"
            fallbackClassName="sp-row-cover sp-row-cover-fallback"
          />
          <RowBody title={hit.title} sub={hit.authorDisplay} />
          {(year || formats) && (
            <div className="sp-row-meta">
              {year && <span>{year}</span>}
              {formats && <span>{formats}</span>}
            </div>
          )}
        </>
      );
    }
    case "author":
      return (
        <>
          <div className="sp-avatar">{initialOf(item.hit.name)}</div>
          <RowBody title={item.hit.name} sub={books(item.hit.bookCount)} />
        </>
      );
    case "series": {
      const by = item.hit.authorDisplay ? ` · ${item.hit.authorDisplay}` : "";
      return (
        <>
          <div className="sp-avatar">S</div>
          <RowBody title={item.hit.name} sub={books(item.hit.bookCount) + by} />
        </>
      );
    }
    case "tag":
      return (
        <>
          <span className="sp-tag-chip"># {item.hit.name}</span>
          <RowBody sub={books(item.hit.bookCount)} />
        </>
      );
    case "genre":
      return (
        <>
          <span className="sp-tag-chip">{item.hit.name}</span>
          <RowBody sub={books(item.hit.bookCount)} />
        </>
      );
    case "setting":
      return (
        <>
          <div className="sp-avatar">
            {item.hit.section.area === "admin" ? (
              <ServerGlyph />
            ) : (
              <SlidersGlyph />
            )}
          </div>
          <RowBody title={item.hit.label} sub={settingsPlace(item.hit)} />
        </>
      );
    default: {
      const _exhaustive: never = item;
      return _exhaustive;
    }
  }
}

function RowBody({ title, sub }: { title?: string; sub: string }) {
  return (
    <div className="sp-row-body">
      {title && <div className="sp-row-title">{title}</div>}
      <div className="sp-row-sub">{sub}</div>
    </div>
  );
}
