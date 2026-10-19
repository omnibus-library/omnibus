import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import {
  type AuthorId,
  authorBooksQuery,
  type Book,
  type BookDetail,
  type CreditedBook,
  type Shelf,
  type Suggestion,
  seriesQuery,
  setShelfMember,
  thumbSrcSet,
  thumbUrl,
  type UserId,
} from "../../api";
import { Button } from "../../components/Button/Button";
import { Cover } from "../../components/Cover/Cover";
import { PlusGlyph } from "../../components/Glyphs/Glyphs";
import { Loading, Ring } from "../../components/Loading/Loading";
import {
  type PickerList,
  ShelfPicker,
} from "../../components/ShelfPicker/ShelfPicker";
import {
  accentStyle,
  ShelfTileFace,
  tileLabelledBy,
} from "../../components/ShelfTile/ShelfTile";
import { formatYear, plural } from "../../format";
import { useCurrentUser } from "../../session";
import { shelvesQuery, suggestionPollMs, suggestionsQuery } from "./queries";
import { SectionHead } from "./SectionHead";
import {
  automaticShelves,
  heldShelves,
  pickerTargets,
  withMemberSummary,
  withMembership,
} from "./shelves";

function SeriesItem({
  item,
  current,
  next,
}: {
  item: Book;
  current: boolean;
  next: boolean;
}) {
  const index = item.series?.index;
  const sub = [index && `Book ${index}`, current && "this book"]
    .filter(Boolean)
    .join(" · ");
  return (
    <Link
      to={`/books/${item.uuid}`}
      className={
        current
          ? "cover-link rx-shelf-item current"
          : "cover-link rx-shelf-item"
      }
    >
      {next && <span className="rx-upnext">Up next</span>}
      <Cover
        book={item}
        src={item.hasCover ? thumbUrl(item.uuid) : null}
        srcSet={item.hasCover ? thumbSrcSet(item.uuid) : undefined}
      />
      <div className="rx-shelf-cap">
        <div className="t">{item.title}</div>
        {sub && <div className="u">{sub}</div>}
      </div>
    </Link>
  );
}

/** The whole series as covers, in reading order. */
function SeriesShelf({
  book,
  seriesId,
}: {
  book: BookDetail;
  seriesId: number;
}) {
  const series = useQuery(seriesQuery(book.seriesId));
  const books = series.data?.books ?? [];
  const at = books.findIndex((b) => b.uuid === book.uuid);
  const seriesPage = (
    <Link to={`/series/${seriesId}`} className="bdmq-k-link">
      series page →
    </Link>
  );
  return (
    <>
      <div className="bdmq-k">
        {book.series?.name}
        {/* The library knows what it holds, not the series' published length. */}
        {series.data &&
          series.data.bookCount > 0 &&
          ` · ${series.data.bookCount} in your library`}
      </div>
      {series.data ? (
        <>
          <div className="rx-shelf" data-testid="bdmq-series-shelf">
            {books.map((item, i) => (
              <SeriesItem
                key={item.uuid}
                item={item}
                current={i === at}
                next={at >= 0 && i === at + 1}
              />
            ))}
          </div>
          <div className="mono bdmq-quiet-hint">{seriesPage}</div>
        </>
      ) : series.isError || series.data === null ? (
        <div
          className="mono bdmq-quiet-hint"
          data-testid="bdmq-series-unavailable"
        >
          the shelf didn’t load — {seriesPage}
        </div>
      ) : (
        <Loading
          kind="section"
          className="start"
          label="Gathering the series"
        />
      )}
    </>
  );
}

function ShelfLink({ shelf, viewerId }: { shelf: Shelf; viewerId: UserId }) {
  return (
    <Link
      to={`/shelves/${shelf.id}`}
      className="shv-card shv-card--compact"
      style={accentStyle(shelf)}
      aria-labelledby={tileLabelledBy(viewerId, shelf, "bdmq-shelf")}
      data-testid={`bdmq-shelf-${shelf.id}`}
    >
      <ShelfTileFace shelf={shelf} viewerId={viewerId} prefix="bdmq-shelf" />
    </Link>
  );
}

/** Every shelf holding the book as a tile, and the picker that files it onto a hand-picked one. */
function ShelfMembership({ book }: { book: BookDetail }) {
  const client = useQueryClient();
  const viewer = useCurrentUser();
  const { queryKey } = shelvesQuery(book.uuid);
  const shelves = useQuery(shelvesQuery(book.uuid));
  const [picking, setPicking] = useState(false);
  const toggle = useMutation({
    mutationFn: ({ shelf, adding }: { shelf: Shelf; adding: boolean }) =>
      setShelfMember(shelf.id, book.uuid, adding),
    // A read begun before the write would answer with the old membership.
    onMutate: () => client.cancelQueries({ queryKey }),
    // The tile, the count and the ledge follow without waiting on a refetch.
    onSuccess: (_done, { shelf, adding }) =>
      client.setQueryData(
        queryKey,
        (facts) =>
          facts && {
            ...facts,
            manualIds: withMembership(facts.manualIds, shelf.id, adding),
            all: withMemberSummary(
              facts.all,
              shelf.id,
              book.uuid,
              book.hasCover,
              adding,
            ),
          },
      ),
    onSettled: () => {
      void client.invalidateQueries({ queryKey });
    },
  });
  const facts = shelves.data;
  const held = facts && heldShelves(facts, viewer);
  const open = () => {
    toggle.reset();
    setPicking(true);
  };
  const list: PickerList = facts
    ? {
        status: "ready",
        targets: pickerTargets(facts.all, viewer),
        checked: facts.manualIds,
        automatic: automaticShelves(facts),
      }
    : shelves.isError
      ? { status: "failed" }
      : { status: "loading" };
  return (
    <>
      <div
        className={book.seriesId === null ? "bdmq-k" : "bdmq-k bdmq-k-below"}
      >
        {book.seriesId === null
          ? "Standalone · on your shelves"
          : "On your shelves"}
      </div>
      {held === undefined ? (
        shelves.isError ? (
          <p
            className="mono bdmq-quiet-hint"
            data-testid="bdmq-shelves-unavailable"
          >
            your shelves didn’t load — see them on the{" "}
            <Link to="/" className="bdmq-k-link">
              library page →
            </Link>
          </p>
        ) : (
          <Loading
            kind="section"
            className="start"
            label="Checking your shelves"
          />
        )
      ) : held.length > 0 ? (
        <div className="bdmq-shelves" data-testid="bdmq-shelves">
          {held.map((shelf) => (
            <ShelfLink key={shelf.id} shelf={shelf} viewerId={viewer.id} />
          ))}
          <button
            type="button"
            className="shelf-add-tile bdmq-shelf-add"
            data-testid="bdmq-add-to-shelf"
            onClick={open}
          >
            <span className="shelf-add-tile-plus">
              <PlusGlyph />
            </span>
            Add to shelf
          </button>
        </div>
      ) : (
        <>
          {/* A series book on no shelf gets only the button: the shelf above already says what it is part of. */}
          {book.seriesId === null && (
            <div className="bdmq-bigquiet">Not on a shelf yet.</div>
          )}
          <div className="bdmq-shelf-actions">
            <Button size="sm" data-testid="bdmq-add-to-shelf" onClick={open}>
              Add to shelf
            </Button>
          </div>
        </>
      )}
      {picking && (
        <ShelfPicker
          list={list}
          viewer={viewer}
          busy={toggle.isPending ? toggle.variables.shelf.id : null}
          error={
            toggle.isError
              ? `Couldn’t update ${toggle.variables.shelf.name}: ${toggle.error.message}`
              : null
          }
          onPick={(id) => {
            const shelf = facts?.all.find((s) => s.id === id);
            if (shelf && facts)
              toggle.mutate({ shelf, adding: !facts.manualIds.includes(id) });
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </>
  );
}

const surname = (author: string) =>
  author.trim().split(/\s+/).at(-1) || "this author";

type LeadProps = {
  author: string;
  owned: number;
  rest: number;
  id: AuthorId | null;
};

/** The card heading the same-hand stack: portrait, name and count, linking to the author page when it has one. */
function AuthorLead({ author, owned, rest, id }: LeadProps) {
  const count = `${owned} book${plural(owned)} in your library`;
  const portrait = (
    <>
      <span className="glyph">{author.charAt(0).toUpperCase()}</span>
      {id !== null && <span className="hint">Author page →</span>}
    </>
  );
  return (
    <div className="cover-link author-lead">
      <div className="author-lead-card">
        {id === null ? (
          <>
            <div className="author-portrait">{portrait}</div>
            <div>
              <div className="author-lead-name">{author}</div>
              <div className="author-lead-count">{count}</div>
            </div>
          </>
        ) : (
          <>
            <Link
              to={`/authors/${id}`}
              className="author-portrait"
              title={
                author.trim()
                  ? `Open ${author}'s author page`
                  : "Open author page"
              }
            >
              {portrait}
            </Link>
            <div>
              <Link to={`/authors/${id}`} className="author-lead-name">
                {author}
              </Link>
              <div className="author-lead-count">{count}</div>
            </div>
            {rest > 0 && (
              <Link to={`/authors/${id}`} className="author-lead-more">
                +{rest} more →
              </Link>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** The author's other books as a spreading stack of covers behind a lead card. */
function SameHand({ book }: { book: BookDetail }) {
  const author = book.authors[0] ?? "";
  const id = book.creators[0]?.id ?? null;
  const page = useQuery(authorBooksQuery(id));
  // The author's page is the source of the count; with no author read, this book alone.
  const credited: CreditedBook[] | undefined =
    id === null ? [book] : page.isPending ? undefined : (page.data ?? [book]);
  const label = surname(author);
  const head = (
    <SectionHead
      kicker={author ? `More by ${author}` : "More to read"}
      title="From the same hand"
      action={
        id !== null && (
          <Link to={`/authors/${id}`} className="btn ghost sm">
            Author page →
          </Link>
        )
      }
    />
  );
  if (credited === undefined) {
    return (
      <>
        {head}
        <Loading
          kind="section"
          className="start"
          label={`Looking for more by ${label}`}
        />
      </>
    );
  }
  const others = credited.filter((b) => b.uuid !== book.uuid);
  const lead = {
    author,
    id,
    owned: credited.length,
    rest: Math.max(0, others.length - 4),
  };
  if (others.length === 0) {
    const holdsThis = credited.some((b) => b.uuid === book.uuid);
    return (
      <>
        {head}
        <div className="bd-same-hand-empty" data-testid="from-same-hand-empty">
          <AuthorLead {...lead} />
          <div className="bd-same-hand-note">
            {holdsThis
              ? `This is the only book by ${label} in your library so far.`
              : `No books by ${label} are in your library yet.`}
          </div>
        </div>
      </>
    );
  }
  return (
    <>
      {head}
      <p className="mono bd-same-hand-hint">
        Hover the row to spread · click a cover to open the book, the portrait
        to open the author
      </p>
      <div className="suggest-stack" data-testid="from-same-hand">
        <AuthorLead {...lead} />
        {others.slice(0, 4).map((other) => {
          const year = other.published && formatYear(other.published);
          return (
            <Link
              key={other.uuid}
              to={`/books/${other.uuid}`}
              className="cover-link"
              data-testid="from-same-hand-tile"
              title={`Open ${other.title}`}
            >
              <Cover
                book={other}
                src={other.hasCover ? thumbUrl(other.uuid) : null}
                srcSet={other.hasCover ? thumbSrcSet(other.uuid) : undefined}
              />
              <div className="sug-cap">
                <div className="sh-title">{other.title}</div>
                {year && <div className="sh-sub">{year}</div>}
              </div>
            </Link>
          );
        })}
      </div>
    </>
  );
}

const COLLAPSED_SUGGESTIONS = 5;

function SuggestionCards({ items }: { items: Suggestion[] }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? items : items.slice(0, COLLAPSED_SUGGESTIONS);
  const more = items.length - COLLAPSED_SUGGESTIONS;
  return (
    <>
      <div className={expanded ? "suggest-static" : "suggest-stack"}>
        {shown.map((s) => (
          <a
            key={s.id}
            className="cover-link suggest-card"
            href={s.hardcoverUrl}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="suggestion-card"
          >
            <Cover
              book={{ title: s.title, authors: [s.author], accent: null }}
              src={s.cover}
            />
            <div className="fan-match mono">
              on {s.lists} list{plural(s.lists)}
            </div>
            <div className="sug-cap">
              <div className="sug-cap-title">{s.title}</div>
              <div className="sug-cap-author">{s.author}</div>
            </div>
          </a>
        ))}
      </div>
      {more > 0 && !expanded && (
        <div className="bd-suggest-actions">
          <Button
            size="sm"
            data-testid="suggestions-show-more"
            onClick={() => setExpanded(true)}
          >
            Show {more} more
          </Button>
        </div>
      )}
    </>
  );
}

/** Hardcover's read-alikes. Nothing at all unless the server has some, or is still looking. */
function Suggestions({ book }: { book: BookDetail }) {
  const client = useQueryClient();
  const { queryKey } = suggestionsQuery(book.uuid);
  const answer = useQuery(suggestionsQuery(book.uuid)).data;
  // Asked as often as it will be, and still no answer: settles as empty.
  const searching =
    suggestionPollMs(
      answer,
      client.getQueryState(queryKey)?.dataUpdateCount ?? 0,
    ) !== false;
  if (!searching && !(answer?.status === "ready" && answer.items.length > 0))
    return null;
  return (
    <>
      <div className="bdmq-morerule" />
      <SectionHead
        kicker={`If you liked ${book.title}…`}
        title="Suggested for you"
      />
      <div className="bd-suggest" data-testid="suggestions-strip">
        {answer?.status === "ready" ? (
          <SuggestionCards items={answer.items} />
        ) : (
          <div
            className="bd-suggest-pending bd-suggest-loading card"
            data-testid="suggestions-pending"
          >
            <Ring />
            <p className="mono bd-stub-hint">
              Looking for read-alikes via Hardcover…
            </p>
          </div>
        )}
      </div>
    </>
  );
}

/** Stop 06: the series shelf, the shelves holding the book, then the author's other work and read-alikes. */
export function MoreStop({ book }: { book: BookDetail }) {
  return (
    <div className="bdmq-tight bdmq-more" data-testid="bdmq-more">
      {book.seriesId !== null && (
        <SeriesShelf book={book} seriesId={book.seriesId} />
      )}
      <ShelfMembership book={book} />
      <div className="bdmq-morerule" />
      <SameHand book={book} />
      <Suggestions book={book} />
    </div>
  );
}
