import { useQuery } from "@tanstack/react-query";
import {
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";
import { Link } from "react-router";
import {
  type BookUuid,
  type Shelf,
  shelvesQuery,
  thumbUrl,
  type UserId,
} from "../../api";
import { attributedOwner } from "../../components/FilterBar/filters";
import {
  CaretLeftGlyph,
  CaretRightGlyph,
  ChevronRightGlyph,
  CogGlyph,
  HeartGlyph,
} from "../../components/Glyphs/Glyphs";
import { Skeleton } from "../../components/Loading/Loading";
import { bookCount } from "../../format";
import { prefersReducedMotion } from "../../motion";
import { useCurrentUser } from "../../session";
import type { ShelfSelection } from "../../viewPrefs";
import {
  pageTarget,
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

// Which way the row can still scroll, kept current as it scrolls, resizes and gains entries.
function useRowReach(row: RefObject<HTMLDivElement | null>) {
  const [before, setBefore] = useState(false);
  const [after, setAfter] = useState(false);
  useEffect(() => {
    const el = row.current;
    if (!el) return;
    // The 4px slack absorbs sub-pixel scroll widths, which would leave the right arrow lit on a row with no overflow.
    const measure = () => {
      setBefore(el.scrollLeft > 4);
      setAfter(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
    };
    const resize = new ResizeObserver(measure);
    const watch = () => {
      resize.observe(el);
      for (const entry of el.children) resize.observe(entry);
    };
    const mutation = new MutationObserver(() => {
      measure();
      watch();
    });
    watch();
    mutation.observe(el, { childList: true });
    el.addEventListener("scroll", measure, { passive: true });
    measure();
    return () => {
      resize.disconnect();
      mutation.disconnect();
      el.removeEventListener("scroll", measure);
    };
  }, [row]);
  return { before, after };
}

type ShelfGalleryProps = {
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
  selection,
  pickedCount,
  allCount,
  allCovers,
  onSelect,
}: ShelfGalleryProps) {
  const allMeta =
    allCount === null ? "Your whole library" : bookCount(allCount);
  const viewerId = useCurrentUser().id;
  const shelves = useQuery(shelvesQuery);
  const rail = shelves.data ? railShelves(shelves.data, viewerId) : [];
  const row = useRef<HTMLDivElement>(null);
  const reach = useRowReach(row);
  const page = (dir: 1 | -1) => {
    const el = row.current;
    if (!el) return;
    const origin = el.getBoundingClientRect().left - el.scrollLeft;
    const starts = [...el.children].map(
      (entry) => entry.getBoundingClientRect().left - origin,
    );
    el.scrollTo({
      left: pageTarget(
        dir,
        el.scrollLeft,
        el.clientWidth,
        el.scrollWidth,
        starts,
      ),
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
  };
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
          className={
            reach.before
              ? "lmq-shnav lmq-shnav--l on"
              : "lmq-shnav lmq-shnav--l"
          }
          aria-label="Earlier shelves"
          tabIndex={reach.before ? 0 : -1}
          onClick={() => page(-1)}
        >
          <CaretLeftGlyph />
        </button>
        <button
          type="button"
          className={
            reach.after ? "lmq-shnav lmq-shnav--r on" : "lmq-shnav lmq-shnav--r"
          }
          aria-label="More shelves"
          tabIndex={reach.after ? 0 : -1}
          onClick={() => page(1)}
        >
          <CaretRightGlyph />
        </button>
        <div ref={row} className="lmq-shtx" id="lmq-shelf-row">
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
          {shelves.isPending &&
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
