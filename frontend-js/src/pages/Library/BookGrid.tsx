import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router";
import type { Book, SeriesStack } from "../../api";
import { CoverImage } from "../../components/Cover/CoverImage";
import { StackGlyph } from "../../components/Glyphs/Glyphs";
import { play, type Rects, snapshot } from "./seriesFlip";
import {
  bandStyle,
  type GridItem,
  gridItems,
  itemKey,
  stackFront,
  stackLeaves,
  stackSegments,
  type Volume,
} from "./seriesStacks";

// The entrance cascade: 40ms steps, wrapping every eight tiles.
const staggerMs = (index: number) => (index % 8) * 40;

function Tile({
  book,
  index,
  volume,
}: {
  book: Book;
  index: number;
  /** A dealt-out volume's run chrome; absent on an ordinary tile. */
  volume?: Volume;
}) {
  const run = volume ? (volume.last ? " ss-vol ss-vol--last" : " ss-vol") : "";
  return (
    // biome-ignore lint/a11y/useSemanticElements: the Atrium grid styles divs; list elements would bring the browser's list margins and padding
    <div
      role="listitem"
      data-flip-key={book.uuid}
      data-flip-from={volume && `stack-${volume.lead}`}
      data-flip-deck={volume?.deck}
    >
      <Link
        to={`/books/${book.uuid}`}
        className={`cover-link lib-tile${run}`}
        style={{
          animationDelay: `${staggerMs(index)}ms`,
          ...(volume && { "--sa": volume.band }),
        }}
        aria-label={`Open details for ${book.title}`}
      >
        <span className="lib-tile-art">
          <CoverImage book={book} />
        </span>
        <span className="lib-tile-cap">
          <span className="lib-tile-title">{book.title}</span>
          {book.authors.length > 0 && (
            <span className="lib-tile-author">{book.authors.join(", ")}</span>
          )}
        </span>
        {volume && <span className="ss-vn">{volume.caption}</span>}
      </Link>
    </div>
  );
}

type StackTileProps = {
  stack: SeriesStack;
  index: number;
  /** Take focus on mount: this stack was just folded. */
  takeFocus: boolean;
  onFocused: () => void;
  onOpen: () => void;
};

/** A folded series: fanned covers, a count badge and progress segments, in its lead's slot. */
function StackTile({
  stack,
  index,
  takeFocus,
  onFocused,
  onOpen,
}: StackTileProps) {
  const tile = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!takeFocus) return;
    tile.current?.focus();
    onFocused();
  }, [takeFocus, onFocused]);

  const count = stack.members.length;
  const front = stackFront(stack);
  const author = front?.authors[0];
  const segments = stackSegments(stack);
  return (
    // biome-ignore lint/a11y/useSemanticElements: the Atrium grid styles divs; list elements would bring the browser's list margins and padding
    <div
      className="ss-cell"
      role="listitem"
      data-flip-key={`stack-${stack.leadUuid}`}
    >
      {/* biome-ignore lint/a11y/useSemanticElements: the tile is a styled block that holds a cover fan, not button content */}
      <div
        ref={tile}
        className="cover-link lib-tile ss-stack"
        role="button"
        tabIndex={0}
        aria-expanded={false}
        aria-label={`${stack.name}, ${count} books`}
        title={`${stack.name} · ${count} books`}
        style={{
          animationDelay: `${staggerMs(index)}ms`,
          ...(front?.accent && { "--accent": front.accent }),
        }}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpen();
          }
        }}
      >
        <span className="lib-tile-art ss-art">
          {stackLeaves(stack).map((leaf, depth) => (
            <span
              key={leaf.uuid}
              className="ss-leaf"
              style={{ "--i": depth, zIndex: 3 - depth }}
            >
              <CoverImage book={leaf} />
            </span>
          ))}
        </span>
        <span className="ss-count">
          <StackGlyph />
          {count} books
        </span>
        {segments && (
          <span className="ss-segs" aria-hidden="true">
            {segments.map((percent, slot) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: a segment is its volume's slot in series order
              <i key={slot}>
                <b style={{ width: `${percent}%` }} />
              </i>
            ))}
          </span>
        )}
        <span className="lib-tile-cap">
          <span className="lib-tile-title">{stack.name}</span>
          <span className="lib-tile-author">
            {author ? `${count} books · ${author}` : `${count} books`}
          </span>
        </span>
      </div>
    </div>
  );
}

/** The dealt-out run's head card; Fold up takes focus so Escape reaches the run without a click. */
function StackCap({
  stack,
  onFold,
}: {
  stack: SeriesStack;
  onFold: () => void;
}) {
  const fold = useRef<HTMLButtonElement>(null);
  useEffect(() => fold.current?.focus(), []);
  const author = stackFront(stack)?.authors[0];
  return (
    // biome-ignore lint/a11y/useSemanticElements: the Atrium grid styles divs; list elements would bring the browser's list margins and padding
    <div
      className="ss-cap"
      role="listitem"
      data-flip-key={`cap-${stack.leadUuid}`}
      style={{ "--sa": bandStyle(stack) }}
    >
      <span className="ss-cap-k">Series</span>
      <h3 className="ss-cap-name">{stack.name}</h3>
      <span className="ss-cap-meta">
        {stack.members.length} in your library
        {author && (
          <>
            <br />
            {author}
          </>
        )}
      </span>
      <span className="ss-cap-acts">
        {stack.seriesId !== null && (
          <Link to={`/series/${stack.seriesId}`} className="ss-cap-go">
            Series page →
          </Link>
        )}
        <button
          ref={fold}
          type="button"
          className="ss-cap-fold"
          onClick={onFold}
        >
          Fold up <kbd>esc</kbd>
        </button>
      </span>
    </div>
  );
}

type BookGridProps = {
  books: Book[];
  /** The series folded into stacks, riding with `books`; empty when none are. */
  stacks: SeriesStack[];
};

/** The cover wall: a tile per book, with each stacked series folded into its lead's slot. */
export function BookGrid({ books, stacks }: BookGridProps) {
  // The dealt-out stack's lead: one series is open at a time.
  const [open, setOpen] = useState<string | null>(null);
  // The stack just folded, so its tile takes focus back from Fold up.
  const [refocus, setRefocus] = useState<string | null>(null);
  // A lead the list no longer holds is no open stack, whatever `open` still says.
  const openLead = stacks.some((s) => s.leadUuid === open) ? open : null;

  // A deal-out or fold replays from the cells' boxes as they were before the click.
  const grid = useRef<HTMLDivElement>(null);
  const first = useRef<Rects | null>(null);
  useLayoutEffect(() => {
    if (grid.current && first.current) play(grid.current, first.current);
    first.current = null;
  });
  const deal = (lead: string | null) => {
    first.current = grid.current && snapshot(grid.current);
    setOpen(lead);
  };

  const fold = () => {
    setRefocus(openLead);
    deal(null);
  };
  const spent = () => setRefocus(null);
  const render = (item: GridItem, index: number) => {
    switch (item.kind) {
      case "book":
        return <Tile book={item.book} index={index} />;
      case "vol":
        return (
          <Tile book={item.volume.book} index={index} volume={item.volume} />
        );
      case "cap":
        return <StackCap stack={item.stack} onFold={fold} />;
      case "stack":
        return (
          <StackTile
            stack={item.stack}
            index={index}
            takeFocus={refocus === item.stack.leadUuid}
            onFocused={spent}
            onOpen={() => {
              setRefocus(null);
              deal(item.stack.leadUuid);
            }}
          />
        );
      default: {
        const _exhaustive: never = item;
        return _exhaustive;
      }
    }
  };
  return (
    // biome-ignore lint/a11y/useSemanticElements: the Atrium grid styles divs; list elements would bring the browser's list margins and padding
    <div
      ref={grid}
      className="lib-grid"
      role="list"
      onKeyDown={(e) => {
        if (e.key === "Escape" && openLead !== null) {
          e.preventDefault();
          fold();
        }
      }}
    >
      {gridItems(books, stacks, openLead).map((item, index) => (
        <Fragment key={itemKey(item)}>{render(item, index)}</Fragment>
      ))}
    </div>
  );
}
