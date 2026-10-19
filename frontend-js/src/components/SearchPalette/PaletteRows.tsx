import { type ReactNode, useState } from "react";
import { Link } from "react-router";
import { type PaletteResults, thumbUrl } from "../../api";
import { formatYear } from "../../format";
import { type SettingsEntry, settingsPlace } from "../../settingsIndex";
import { ServerGlyph, SlidersGlyph } from "../Glyphs/Glyphs";
import { itemHref, itemKey, type PaletteItem } from "./selection";

type Book = PaletteResults["books"][number];

const plural = (n: number) => (n === 1 ? "" : "s");
const books = (n: number) => `${n} book${plural(n)}`;
const initialOf = (name: string) => (name[0] ?? "?").toUpperCase();

type ResultsListProps = {
  results: PaletteResults | undefined;
  settings: readonly SettingsEntry[];
  highlighted: string | null;
  onPick: () => void;
};

/** The grouped rows: books, authors, series, tags and genres, then settings. */
export function ResultsList({
  results,
  settings,
  highlighted,
  onPick,
}: ResultsListProps) {
  const row = (item: PaletteItem, testId: string, children: ReactNode) => {
    const key = itemKey(item);
    return (
      <Link
        key={key}
        to={itemHref(item)}
        className={key === highlighted ? "sp-row selected" : "sp-row"}
        data-testid={testId}
        onClick={onPick}
      >
        {children}
      </Link>
    );
  };
  return (
    <div className="sp-results">
      {results && (
        <>
          <Group label="Books" count={results.books.length}>
            {results.books.map((b) =>
              row(
                { kind: "book", uuid: b.uuid, title: b.title },
                "sp-book-row",
                <BookRowBody book={b} />,
              ),
            )}
          </Group>
          <Group label="Authors" count={results.authors.length}>
            {results.authors.map((a) =>
              row(
                { kind: "author", id: a.id, name: a.name },
                "sp-author-row",
                <>
                  <div className="sp-avatar">{initialOf(a.name)}</div>
                  <RowBody title={a.name} sub={books(a.bookCount)} />
                </>,
              ),
            )}
          </Group>
          <Group label="Series" count={results.series.length}>
            {results.series.map((s) =>
              row(
                { kind: "series", id: s.id, name: s.name },
                "sp-series-row",
                <>
                  <div className="sp-avatar">S</div>
                  <RowBody
                    title={s.name}
                    sub={`${books(s.bookCount)}${s.authorDisplay ? ` · ${s.authorDisplay}` : ""}`}
                  />
                </>,
              ),
            )}
          </Group>
          <Group label="Tags" count={results.tags.length}>
            {results.tags.map((t) =>
              row(
                { kind: "tag", id: t.id, name: t.name },
                "sp-tag-row",
                <>
                  <span className="sp-tag-chip"># {t.name}</span>
                  <RowBody sub={books(t.bookCount)} />
                </>,
              ),
            )}
          </Group>
          <Group label="Genres" count={results.genres.length}>
            {results.genres.map((g) =>
              row(
                { kind: "genre", name: g.name },
                "sp-genre-row",
                <>
                  <span className="sp-tag-chip">{g.name}</span>
                  <RowBody sub={books(g.bookCount)} />
                </>,
              ),
            )}
          </Group>
        </>
      )}
      <Group label="Settings" count={settings.length}>
        {settings.map((entry) =>
          row(
            { kind: "setting", entry },
            "sp-setting-row",
            <>
              <div className="sp-avatar">
                {entry.section.area === "admin" ? (
                  <ServerGlyph />
                ) : (
                  <SlidersGlyph />
                )}
              </div>
              <RowBody title={entry.label} sub={settingsPlace(entry)} />
            </>,
          ),
        )}
      </Group>
    </div>
  );
}

function Group({
  label,
  count,
  children,
}: {
  label: string;
  count: number;
  children: ReactNode;
}) {
  if (count === 0) return null;
  return (
    <>
      <div className="sp-group-head label">
        {label} · {count}
      </div>
      {children}
    </>
  );
}

function RowBody({ title, sub }: { title?: string; sub: string }) {
  return (
    <div className="sp-row-body">
      {title && <div className="sp-row-title">{title}</div>}
      <div className="sp-row-sub">{sub}</div>
    </div>
  );
}

function BookRowBody({ book }: { book: Book }) {
  const year = book.year ? formatYear(book.year) : null;
  const formats = book.formats.join(" · ");
  return (
    <>
      <BookThumb book={book} />
      <RowBody title={book.title} sub={book.authorDisplay} />
      {(year || formats) && (
        <div className="sp-row-meta">
          {year && <span>{year}</span>}
          {formats && <span>{formats}</span>}
        </div>
      )}
    </>
  );
}

// A failed thumbnail falls back to the accent plate rather than a broken image.
function BookThumb({ book }: { book: Book }) {
  const [broken, setBroken] = useState(false);
  if (book.hasCover && !broken) {
    return (
      <img
        className="sp-row-cover"
        src={thumbUrl(book.uuid, "sm")}
        alt=""
        loading="lazy"
        onError={() => setBroken(true)}
      />
    );
  }
  return (
    <div
      className="sp-row-cover sp-row-cover-fallback"
      style={{ background: book.accent ?? "var(--bg-2)" }}
    >
      {initialOf(book.title)}
    </div>
  );
}
