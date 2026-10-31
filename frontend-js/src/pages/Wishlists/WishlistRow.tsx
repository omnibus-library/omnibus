import { Link } from "react-router";
import { thumbUrl, type UserId, type WishlistBook } from "../../api";
import { Cover } from "../../components/Cover/Cover";
import type { Scope } from "./wishlists";
import { addedLabel, byline, holdingLabel, wantedByNames } from "./wishlists";

function Holdings({ holdings }: Pick<WishlistBook, "holdings">) {
  if (holdings.length === 0) {
    return (
      <span className="wl-none">
        <span aria-hidden="true" className="wl-none-dash">
          —
        </span>
        <span className="wl-none-text">Not in the library</span>
      </span>
    );
  }
  return (
    <ul className="wl-holdings" aria-label="In the library">
      {holdings.map((holding) => {
        const { name, times } = holdingLabel(holding);
        return (
          <li key={holding.format} className="wl-holding">
            <span className="wl-badge">{name}</span>
            {times && <span className="wl-times">{times}</span>}
          </li>
        );
      })}
    </ul>
  );
}

/** One wishlisted book: its cover and title, what the library holds of it, and who added it or when. */
export function WishlistRow({
  book,
  scope,
  viewer,
  now,
}: {
  book: WishlistBook;
  scope: Scope;
  viewer: UserId;
  now: number;
}) {
  const detail = `/books/${book.uuid}`;
  const wanted = scope.kind === "everyone";
  return (
    <li className="wl-row" data-testid="wishlists-row" data-uuid={book.uuid}>
      {/* The title link is the one a keyboard or screen reader meets. */}
      <Link to={detail} className="wl-cover" tabIndex={-1} aria-hidden="true">
        <Cover book={book} src={book.hasCover ? thumbUrl(book.uuid) : null} />
      </Link>
      <div className="wl-book">
        <Link to={detail} className="wl-title">
          {book.title}
        </Link>
        <p className="wl-byline">{byline(book)}</p>
      </div>
      <div className="wl-library">
        <Holdings holdings={book.holdings} />
      </div>
      <p className={wanted ? "wl-meta wl-wanted" : "wl-meta wl-added"}>
        <span className="wl-prefix">{wanted ? "Wanted by " : "Added "}</span>
        {wanted
          ? wantedByNames(book.wantedBy, viewer)
          : addedLabel(book.addedAt, now)}
      </p>
    </li>
  );
}
