import type { CSSProperties } from "react";
import { type Shelf, thumbUrl, type UserId } from "../../api";
import { plural } from "../../format";
import {
  BookmarkGlyph,
  CogGlyph,
  HeartGlyph,
  LockGlyph,
  PeopleGlyph,
} from "../Glyphs/Glyphs";
import { UserAvatar } from "../UserAvatar/UserAvatar";
import "./ShelfTile.css";

/** How many books stand on a tile's ledge. */
export const LEDGE_BOOKS = 4;

const KIND_LABEL = {
  smart: "Smart",
  manual: "Hand-picked",
  wishlist: "Wishlist",
} satisfies Record<Shelf["kind"], string>;

const EMPTY_LEDGE = {
  smart: "No matches yet",
  manual: "Empty shelf",
  wishlist: "Nothing wished for",
} satisfies Record<Shelf["kind"], string>;

/** The glyph marking a shelf's kind. */
export function KindGlyph({ kind }: { kind: Shelf["kind"] }) {
  switch (kind) {
    case "smart":
      return <CogGlyph />;
    case "manual":
      return <BookmarkGlyph />;
    case "wishlist":
      return <HeartGlyph />;
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

/** The tile wrapper's accent: the shelf's own, or the app's. */
export const accentStyle = (shelf: Shelf): CSSProperties => ({
  "--shelf-accent": shelf.accent ?? "var(--accent)",
});

/** Whether a tile says whose shelf this is: a stranger's, other than a Wishlist, whose name already does. */
const showsOwner = (viewerId: UserId, shelf: Shelf) =>
  viewerId !== shelf.owner.id && shelf.kind !== "wishlist";

/** Whose shelf this is, as the viewer reads it: "You", "by {name}", or the bare name for a Wishlist. */
export function ownerLabel(viewerId: UserId, shelf: Shelf): string {
  if (viewerId === shelf.owner.id) return "You";
  return showsOwner(viewerId, shelf)
    ? `by ${shelf.owner.name}`
    : shelf.owner.name;
}

/** The ids naming a tile: the shelf's name, then its owner's wherever the tile says whose it is. */
export const tileLabelledBy = (
  viewerId: UserId,
  shelf: Shelf,
  prefix: string,
) =>
  showsOwner(viewerId, shelf)
    ? `${prefix}-name-${shelf.id} ${prefix}-owner-${shelf.id}`
    : `${prefix}-name-${shelf.id}`;

function Ledge({ shelf }: { shelf: Shelf }) {
  // A shelf with members but no covers still stands blank plates on the ledge.
  const blanks =
    shelf.covers.length === 0 ? Math.min(shelf.bookCount, LEDGE_BOOKS) : 0;
  return (
    <div className="shv-ledge" aria-hidden="true">
      {shelf.covers.slice(0, LEDGE_BOOKS).map((uuid) => (
        <span key={uuid} className="shv-ledge-book">
          <img
            src={thumbUrl(uuid, "sm")}
            alt=""
            loading="lazy"
            draggable={false}
          />
        </span>
      ))}
      {Array.from({ length: blanks }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: identical blank plates
        <span key={i} className="shv-ledge-book shv-ledge-book--blank" />
      ))}
      {shelf.bookCount === 0 && (
        <span className="shv-ledge-empty">
          <KindGlyph kind={shelf.kind} />
          {EMPTY_LEDGE[shelf.kind]}
        </span>
      )}
    </div>
  );
}

/** A tile's inner markup — ledge, name, facets and foot — for the link, button or block around it. */
export function ShelfTileFace({
  shelf,
  viewerId,
  prefix,
  ownerLabel: owner = ownerLabel(viewerId, shelf),
}: {
  shelf: Shelf;
  viewerId: UserId;
  /** Names the tile's ids, so one shelf drawn twice on a page keeps its labels apart. */
  prefix: string;
  /** What the foot says in place of `ownerLabel(viewerId, shelf)`. */
  ownerLabel?: string;
}) {
  return (
    <>
      <Ledge shelf={shelf} />
      <div className="shv-card-body">
        <div className="shv-card-name" id={`${prefix}-name-${shelf.id}`}>
          {shelf.name}
        </div>
        <div className="shv-card-facets">
          <span className="shv-facet shv-facet--kind">
            <KindGlyph kind={shelf.kind} />
            {KIND_LABEL[shelf.kind]}
          </span>
          <span className="shv-facet">
            {shelf.visibility === "private" ? <LockGlyph /> : <PeopleGlyph />}
            {shelf.visibility === "private" ? "Private" : "Public"}
          </span>
        </div>
        <div className="shv-card-foot">
          <span className="shv-card-count">
            {shelf.bookCount} book{plural(shelf.bookCount)}
          </span>
          <span className="shv-card-owner">
            {/* The name sits beside it, so the photo's alt would only repeat it in the tile's name. */}
            <span className="shv-card-owner-av" aria-hidden="true">
              <UserAvatar
                user={shelf.owner}
                className="shv-av"
                photoClassName="shv-av-photo"
              />
            </span>
            <span
              className="shv-card-owner-name"
              id={`${prefix}-owner-${shelf.id}`}
            >
              {owner}
            </span>
          </span>
        </div>
      </div>
    </>
  );
}
