import type { ReactNode } from "react";
import { Link } from "react-router";
import { type BookUuid, type Shelf, thumbUrl, type UserId } from "../../api";
import type { ShelfList } from "../../components/FilterBar/filters";
import {
  CaretLeftGlyph,
  CaretRightGlyph,
  ChevronRightGlyph,
  CogGlyph,
  HeartGlyph,
} from "../../components/Glyphs/Glyphs";
import { Skeleton } from "../../components/Loading/Loading";
import type { ShelfSelection } from "../../viewPrefs";
import {
  attributedOwner,
  railShelves,
  shelfAriaLabel,
  shelfTabMeta,
} from "./shelfGallery";

// Three covers hint at a shelf without becoming a mosaic again.
const PEEK_COVERS = 3;

/** The covers that slide in above a name on hover, or a plate carrying the kind glyph when there are none. */
function Peek({ covers, glyph }: { covers: BookUuid[]; glyph?: ReactNode }) {
  return (
    <span className="lmq-shent-peek" aria-hidden="true">
      {covers.length === 0 ? (
        <span className="lmq-shent-none">{glyph}</span>
      ) : (
        covers.slice(0, PEEK_COVERS).map((uuid) => (
          <span key={uuid}>
            <img
              src={thumbUrl(uuid, "sm")}
              alt=""
              loading="lazy"
              draggable={false}
            />
          </span>
        ))
      )}
    </span>
  );
}

function badgeFor(kind: Shelf["kind"]): ReactNode {
  if (kind === "smart") return <CogGlyph />;
  return kind === "wishlist" ? <HeartGlyph /> : null;
}

function ShelfEntry({
  shelf,
  count,
  active,
  viewerId,
  onSelect,
}: {
  shelf: Shelf;
  count: number;
  active: boolean;
  viewerId: UserId;
  onSelect: () => void;
}) {
  const owner = attributedOwner(shelf, viewerId);
  const badge = badgeFor(shelf.kind);
  return (
    <button
      type="button"
      className="lmq-shent"
      aria-pressed={active}
      aria-label={shelfAriaLabel(shelf, count, owner)}
      onClick={onSelect}
    >
      <Peek covers={shelf.coverUuids} glyph={badge} />
      <span className="lmq-shent-name">{shelf.name}</span>
      <span className="lmq-shent-meta">
        {badge}
        {shelfTabMeta(count, owner)}
      </span>
    </button>
  );
}

type ShelfGalleryProps = {
  shelves: ShelfList;
  viewerId: UserId;
  selection: ShelfSelection;
  /** How many books the picked shelf holds, once its whole member list has loaded. */
  pickedCount: number | null;
  /** The whole library's book count, once page 1 has answered. */
  allCount: number | null;
  /** The covers the All Books entry peeks with. */
  allCovers: BookUuid[];
  onSelect: (selection: ShelfSelection) => void;
};

/** The shelves row: All Books and each shelf as toggles that pick which list the page shows. */
export function ShelfGallery({
  shelves,
  viewerId,
  selection,
  pickedCount,
  allCount,
  allCovers,
  onSelect,
}: ShelfGalleryProps) {
  const allMeta =
    allCount === null
      ? "Your whole library"
      : `${allCount} book${allCount === 1 ? "" : "s"}`;
  const rail =
    shelves.state === "loaded" ? railShelves(shelves.shelves, viewerId) : [];
  return (
    <section className="lmq-shelves" aria-labelledby="lmq-shelves-title">
      <h2 className="lmq-shelves-title" id="lmq-shelves-title">
        Shelves
      </h2>
      <div className="lmq-slab-acts">
        <Link to="/shelves" className="lmq-slink">
          All shelves
          <ChevronRightGlyph />
        </Link>
      </div>
      <div className="lmq-shwrap">
        <button
          type="button"
          className="lmq-shnav lmq-shnav--l"
          aria-label="Earlier shelves"
          tabIndex={-1}
        >
          <CaretLeftGlyph />
        </button>
        <button
          type="button"
          className="lmq-shnav lmq-shnav--r"
          aria-label="More shelves"
          tabIndex={-1}
        >
          <CaretRightGlyph />
        </button>
        <div className="lmq-shtx" id="lmq-shelf-row">
          <button
            type="button"
            className="lmq-shent"
            aria-pressed={selection.kind === "all"}
            aria-label={`All Books, ${allMeta}`}
            onClick={() => onSelect({ kind: "all" })}
          >
            <Peek covers={allCovers} />
            <span className="lmq-shent-name">All Books</span>
            {allCount !== null && (
              <span className="lmq-shent-meta">{allCount}</span>
            )}
          </button>
          {rail.map((shelf) => {
            const active =
              selection.kind === "shelf" && selection.id === shelf.id;
            return (
              <ShelfEntry
                key={shelf.id}
                shelf={shelf}
                count={
                  active && pickedCount !== null ? pickedCount : shelf.bookCount
                }
                active={active}
                viewerId={viewerId}
                onSelect={() => onSelect({ kind: "shelf", id: shelf.id })}
              />
            );
          })}
          {shelves.state === "pending" &&
            [0, 1, 2].map((i) => (
              <span
                key={i}
                className="lmq-shent lmq-shent-pending"
                aria-hidden="true"
              >
                <Skeleton
                  index={i}
                  style={{ "--w": `${118 - i * 18}px`, height: 20 }}
                />
              </span>
            ))}
        </div>
      </div>
    </section>
  );
}
