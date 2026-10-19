import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { fetchPalette, type PaletteResults, thumbUrl } from "../../api";
import { BusyLabel, Loading } from "../../components/Loading/Loading";
import { PageTitle } from "../../components/PageTitle/PageTitle";
import { searchHref } from "../../components/SearchPalette/selection";
import { facetQuery, singleFacetValue } from "../../format";
import {
  cutNote,
  highlightParts,
  matchesTag,
  type Section,
  sectionOrder,
  summaryLine,
} from "./results";
import "./Search.css";

/** `/search/:query`: every group of hits, with the searched term highlighted. */
export function Search() {
  const query = useParams().query ?? "";
  const search = useQuery({
    queryKey: ["palette", query.trim()],
    queryFn: ({ signal }) => fetchPalette(query.trim(), { signal }),
  });
  return (
    <section className="search-page">
      <PageTitle page={`Search: ${query}`} />
      {search.status === "pending" && (
        <Loading kind="page" label="Searching the shelves" />
      )}
      {search.status === "error" && (
        <p role="alert" className="subtitle">
          {search.error.message}
        </p>
      )}
      {search.status === "success" && (
        <SearchResults key={query} results={search.data} query={query} />
      )}
    </section>
  );
}

const LABELS: Record<Section, string> = {
  books: "Books",
  authors: "Authors",
  series: "Series",
  tags: "Tags",
  genres: "Genres",
};

const anchor = (section: Section) => `results-${section}`;
const plural = (n: number) => (n === 1 ? "" : "s");

function totalOf(results: PaletteResults): number {
  const t = results.totals;
  return t.books + t.authors + t.series + t.tags + t.genres;
}

type ResultsProps = { results: PaletteResults; query: string };

function SearchResults({ results: preview, query }: ResultsProps) {
  const expansion = useExpansion(preview, query);
  const results = expansion.results;
  const total = totalOf(results);
  // A one-facet query is headed by the name the reader clicked, not tag:"…".
  const heading = singleFacetValue(query) ?? query;
  if (total === 0) {
    return (
      <>
        <div className="search-head">
          <div>
            <div className="label">Search results</div>
            <h1 className="search-title">
              No results for “<Highlight text={heading} query={heading} />”
            </h1>
          </div>
        </div>
        <p className="subtitle" data-testid="search-result-count">
          0 results · fts5 · {results.durationMs}ms
        </p>
      </>
    );
  }
  // Ordered off the preview, so opening a group never reshuffles the page.
  const order = sectionOrder(preview, query);
  return (
    <>
      <div className="search-head">
        <div>
          <div className="label">Search results</div>
          <h1 className="search-title">
            <span className="search-title-n">{total}</span> result
            {plural(total)} for “<Highlight text={heading} query={heading} />”
          </h1>
        </div>
      </div>
      <p className="search-summary mono" data-testid="search-result-count">
        {summaryLine(results)}
      </p>
      <div className="search-layout">
        <div className="search-main">
          {order.map((section, i) => (
            <div key={section} className="search-section-slot">
              {i > 0 && <div className="divider" />}
              <ResultSection
                section={section}
                results={results}
                query={query}
                expansion={expansion}
              />
            </div>
          ))}
        </div>
        <OnThisPage order={order} results={results} />
      </div>
    </>
  );
}

function OnThisPage({
  order,
  results,
}: {
  order: readonly Section[];
  results: PaletteResults;
}) {
  return (
    <aside className="search-rail">
      <div className="label search-rail-head">On this page</div>
      <div className="search-rail-list">
        {order.map((section, i) => (
          <a
            key={section}
            href={`#${anchor(section)}`}
            className={
              i === 0
                ? "search-rail-item search-rail-item-active"
                : "search-rail-item"
            }
          >
            <span>{LABELS[section]}</span>
            <span className="search-rail-count mono">
              {results.totals[section]}
            </span>
          </a>
        ))}
      </div>
    </aside>
  );
}

// The palette's own cap, so a collapsed group needs no second fetch.
const PREVIEW = 5;

type Expansion = {
  /** The preview, or the fuller answer once a group has asked for its rest. */
  results: PaletteResults;
  open: readonly Section[];
  busy: Section | null;
  failed: Section | null;
  toggle: (section: Section) => void;
};

// A group opens at once when the preview already holds every hit; otherwise
// it fetches the whole group first, at the size its total names.
function useExpansion(preview: PaletteResults, query: string): Expansion {
  const [fuller, setFuller] = useState<PaletteResults | null>(null);
  const [open, setOpen] = useState<readonly Section[]>([]);
  const [busy, setBusy] = useState<Section | null>(null);
  const [failed, setFailed] = useState<Section | null>(null);
  const results = fuller ?? preview;
  const toggle = (section: Section) => {
    if (open.includes(section)) {
      setOpen(open.filter((s) => s !== section));
      return;
    }
    const want = results.totals[section];
    if (results[section].length >= want) {
      setOpen([...open, section]);
      return;
    }
    setBusy(section);
    setFailed(null);
    fetchPalette(query.trim(), { limit: want })
      .then((answer) => {
        setFuller(answer);
        setOpen((was) => [...was, section]);
      })
      .catch(() => setFailed(section))
      .finally(() => setBusy(null));
  };
  return { results, open, busy, failed, toggle };
}

type SectionProps = ResultsProps & { section: Section };

function ResultSection({
  section,
  results,
  query,
  expansion,
}: SectionProps & { expansion: Expansion }) {
  const tagMatch = matchesTag(results, query);
  const sub: Record<Section, string | null> = {
    books: tagMatch ? "in matched tags" : null,
    tags: tagMatch ? "matched in tag name" : "related to your matches",
    genres: "matched in genre name",
    authors: null,
    series: null,
  };
  const count = results.totals[section];
  const isOpen = expansion.open.includes(section);
  const busy = expansion.busy === section;
  const note = isOpen ? cutNote(section, results) : null;
  return (
    <section id={anchor(section)} className="search-section">
      <div className="search-section-head">
        <div className="label">{LABELS[section]}</div>
        <div className="mono search-section-count">· {count}</div>
        {sub[section] && (
          <div className="search-section-sub">{sub[section]}</div>
        )}
        {count > PREVIEW && (
          <button
            type="button"
            className="search-section-all"
            data-testid={`search-show-all-${anchor(section)}`}
            aria-expanded={isOpen}
            aria-busy={busy}
            disabled={busy}
            onClick={() => expansion.toggle(section)}
          >
            <BusyLabel
              busy={busy}
              label={isOpen ? "Show fewer" : `Show all ${count}`}
              busyLabel="Loading…"
            />
          </button>
        )}
      </div>
      <SectionBody
        section={section}
        results={results}
        query={query}
        shown={isOpen ? Number.POSITIVE_INFINITY : PREVIEW}
      />
      {note && (
        <p
          className="search-section-note mono"
          data-testid="search-section-cut"
        >
          {note}
        </p>
      )}
      {expansion.failed === section && (
        <p
          className="search-section-note"
          role="alert"
          data-testid="search-section-error"
        >
          Couldn’t load the rest — try again.
        </p>
      )}
    </section>
  );
}

function SectionBody({
  section,
  results,
  query,
  shown,
}: SectionProps & { shown: number }) {
  switch (section) {
    case "books":
      return (
        <div className="search-cover-grid">
          {results.books.slice(0, shown).map((book) => (
            <Link
              key={book.uuid}
              to={`/books/${book.uuid}`}
              className="search-cover-card"
              data-testid="search-book-row"
            >
              <BookCover book={book} />
              <div className="search-cover-title">
                <Highlight text={book.title} query={query} />
              </div>
              <div className="search-cover-sub">{book.authorDisplay}</div>
            </Link>
          ))}
        </div>
      );
    case "authors":
      return (
        <div className="search-card-grid">
          {results.authors.slice(0, shown).map((author) => (
            <Link
              key={author.id}
              to={`/authors/${author.id}`}
              className="search-entity"
              data-testid="search-author-row"
            >
              <div className="search-avatar">
                {(author.name[0] ?? "?").toUpperCase()}
              </div>
              <div className="search-entity-body">
                <div className="search-entity-title">
                  <Highlight text={author.name} query={query} />
                </div>
                <div className="search-entity-sub mono">
                  {author.bookCount} book{plural(author.bookCount)}
                  {author.leadBookTitle && ` · incl. ${author.leadBookTitle}`}
                </div>
              </div>
              <span className="search-entity-arrow">→</span>
            </Link>
          ))}
        </div>
      );
    case "series":
      return (
        <div className="search-card-grid">
          {results.series.slice(0, shown).map((s) => (
            <Link
              key={s.id}
              to={`/series/${s.id}`}
              className="search-entity"
              data-testid="search-series-row"
            >
              <div className="search-avatar search-avatar-series">≋</div>
              <div className="search-entity-body">
                <div className="search-entity-title search-entity-title-serif">
                  <Highlight text={s.name} query={query} />
                </div>
                <div className="search-entity-sub mono">
                  {s.leadBookTitle
                    ? `incl. ${s.leadBookTitle}`
                    : `${s.bookCount} book${plural(s.bookCount)}`}
                  {s.authorDisplay && ` · ${s.authorDisplay}`}
                </div>
              </div>
              <span className="search-entity-n mono">{s.bookCount}</span>
            </Link>
          ))}
        </div>
      );
    case "tags":
      return (
        <FacetChips
          facet="tag"
          testId="search-tag-row"
          values={results.tags.slice(0, shown)}
          query={query}
        />
      );
    case "genres":
      return (
        <FacetChips
          facet="genre"
          testId="search-genre-row"
          values={results.genres.slice(0, shown)}
          query={query}
        />
      );
    default: {
      const _exhaustive: never = section;
      return _exhaustive;
    }
  }
}

type FacetChipsProps = {
  facet: "tag" | "genre";
  testId: string;
  values: readonly { name: string; bookCount: number }[];
  query: string;
};

// A genre has no page of its own, so both kinds of chip narrow the search.
function FacetChips({ facet, testId, values, query }: FacetChipsProps) {
  const q = query.toLowerCase();
  return (
    <div className="search-tags">
      {values.map((v) => (
        <Link
          key={v.name}
          to={searchHref(facetQuery(facet, v.name))}
          className={
            v.name.toLowerCase().includes(q)
              ? "chip search-tag search-tag-matched"
              : "chip search-tag"
          }
          data-testid={testId}
        >
          <Highlight text={v.name} query={query} />
          <span className="search-tag-count"> · {v.bookCount}</span>
        </Link>
      ))}
    </div>
  );
}

function Highlight({ text, query }: { text: string; query: string }) {
  const parts = highlightParts(text, query);
  if (!parts.some((part) => part.hit)) return text;
  // Parts are positional and never reorder, so their index is a stable key.
  return parts.map((part, i) =>
    part.hit ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: see above
      <em key={i} className="search-hit">
        {part.text}
      </em>
    ) : (
      // biome-ignore lint/suspicious/noArrayIndexKey: see above
      <span key={i}>{part.text}</span>
    ),
  );
}

type Book = PaletteResults["books"][number];

function BookCover({ book }: { book: Book }) {
  const [broken, setBroken] = useState(false);
  if (book.hasCover && !broken) {
    return (
      <img
        className="search-cover-thumb"
        src={thumbUrl(book.uuid)}
        alt=""
        loading="lazy"
        onError={() => setBroken(true)}
      />
    );
  }
  return (
    <div
      className="search-cover-thumb search-cover-fallback"
      style={{ background: book.accent ?? "var(--bg-2)" }}
    >
      {(book.title[0] ?? "?").toUpperCase()}
    </div>
  );
}
