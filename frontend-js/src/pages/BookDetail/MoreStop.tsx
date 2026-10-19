import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import {
  type Book,
  type BookDetail,
  type Shelf,
  setShelfMember,
  thumbSrcSet,
  thumbUrl,
  type UserId,
} from "../../api";
import { Button } from "../../components/Button/Button";
import { Cover } from "../../components/Cover/Cover";
import { PlusGlyph } from "../../components/Glyphs/Glyphs";
import { Loading } from "../../components/Loading/Loading";
import {
  type PickerList,
  ShelfPicker,
} from "../../components/ShelfPicker/ShelfPicker";
import {
  accentStyle,
  ShelfTileFace,
  tileLabelledBy,
} from "../../components/ShelfTile/ShelfTile";
import { useCurrentUser } from "../../session";
import { seriesQuery, shelvesQuery } from "./queries";
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
      ) : series.isError ? (
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
    // The tile, the count and the ledge follow without a refetch.
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
          heading="Add to shelf"
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

/** Stop 06: the series shelf and the shelves holding the book. */
export function MoreStop({ book }: { book: BookDetail }) {
  return (
    <div className="bdmq-tight bdmq-more" data-testid="bdmq-more">
      {book.seriesId !== null && (
        <SeriesShelf book={book} seriesId={book.seriesId} />
      )}
      <ShelfMembership book={book} />
    </div>
  );
}
