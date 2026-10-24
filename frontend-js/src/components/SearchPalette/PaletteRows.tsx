import { Link } from "react-router";
import { formatYear, initialOf, plural } from "../../format";
import { settingsPlace } from "../../settingsIndex";
import { BookThumb } from "../BookThumb/BookThumb";
import { ServerGlyph, SlidersGlyph } from "../Glyphs/Glyphs";
import {
  itemHref,
  itemKey,
  LISTBOX_ID,
  optionId,
  type PaletteGroup,
  type PaletteItem,
} from "./selection";

const books = (n: number) => `${n} book${plural(n)}`;

// The arrow keys leave focus in the input, so the highlight must scroll itself.
const keepInView = (row: HTMLElement | null) =>
  row?.scrollIntoView({ block: "nearest" });

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

/** The grouped rows, in the order the arrow keys walk them: a listbox of labelled groups of options. */
export function ResultsList({ groups, highlighted, onPick }: ResultsListProps) {
  let flatIndex = 0;
  return (
    <div
      className="sp-results"
      id={LISTBOX_ID}
      role="listbox"
      aria-label="Search results"
    >
      {groups.map((group) => {
        const headId = `sp-group-${group.label.toLowerCase()}`;
        return (
          // biome-ignore lint/a11y/useSemanticElements: a fieldset brings a border and min-width the palette never resets
          <div key={group.label} role="group" aria-labelledby={headId}>
            <div className="sp-group-head label" id={headId}>
              {group.label} · {group.items.length}
            </div>
            {group.items.map((item) => {
              const key = itemKey(item);
              const selected = key === highlighted;
              return (
                <Link
                  key={key}
                  id={optionId(flatIndex++)}
                  role="option"
                  aria-selected={selected}
                  to={itemHref(item)}
                  className={selected ? "sp-row selected" : "sp-row"}
                  ref={selected ? keepInView : undefined}
                  data-testid={TEST_IDS[item.kind]}
                  onClick={onPick}
                >
                  <RowContent item={item} />
                </Link>
              );
            })}
          </div>
        );
      })}
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
