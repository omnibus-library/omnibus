import { type ReactNode, useRef, useState } from "react";
import { Link } from "react-router";
import type { UserId, WishlistReader, WishlistReaders } from "../../api";
import { PeopleGlyph } from "../../components/Glyphs/Glyphs";
import { Skeleton } from "../../components/Loading/Loading";
import { UserAvatar } from "../../components/UserAvatar/UserAvatar";
import { readerOf, type Scope } from "./wishlistView";

const avatarOf = (reader: WishlistReader) => (
  <UserAvatar
    user={{
      id: reader.id as UserId,
      name: reader.name,
      hasAvatar: reader.has_avatar,
    }}
    className="wl-avatar"
    photoClassName="wl-avatar-photo"
  />
);

const EVERYONE_ICON = (
  <span className="wl-avatar wl-avatar-everyone" aria-hidden="true">
    <PeopleGlyph size={16} />
  </span>
);

type ChoiceProps = { onChoose?: () => void };

function ReaderLinks({
  data,
  scope,
  onChoose,
}: ChoiceProps & { data: WishlistReaders; scope: Scope }) {
  const everyone = scope.kind === "everyone";
  const here = readerOf(scope, data.readers);
  return (
    <>
      <Link
        className="wl-reader"
        data-testid="wishlists-reader-everyone"
        to="/wishlists?user=all"
        aria-current={everyone ? "page" : undefined}
        onClick={onChoose}
      >
        {EVERYONE_ICON}
        <span className="wl-reader-name">Everyone</span>
        <span className="wl-reader-count">{data.everyone}</span>
      </Link>
      <hr className="wl-rule" />
      <ul className="wl-readers">
        {data.readers.map((reader) => (
          <li key={reader.id}>
            <Link
              className="wl-reader"
              data-testid={
                reader.is_you
                  ? "wishlists-reader-you"
                  : `wishlists-reader-${reader.id}`
              }
              to={reader.is_you ? "/wishlists" : `/wishlists?user=${reader.id}`}
              aria-current={here?.id === reader.id ? "page" : undefined}
              onClick={onChoose}
            >
              {avatarOf(reader)}
              <span className="wl-reader-name">
                {reader.is_you ? "You" : reader.name}
              </span>
              <span className="wl-reader-count">{reader.count}</span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

function PanelSkeleton() {
  return (
    <div className="wl-panel-skeleton" aria-hidden="true">
      {[...Array(5).keys()].map((i) => (
        <div key={i} className="wl-panel-skeleton-row">
          <Skeleton shape="circle" index={i} />
          <Skeleton index={i} style={{ "--w": `${50 + ((i * 29) % 40)}%` }} />
        </div>
      ))}
    </div>
  );
}

/** The wide screen's list of whose wishlist to read: everyone's, then each reader's with their count. A failed read says so rather than waiting. */
export function ReaderPanel({
  data,
  failed,
  scope,
}: {
  data: WishlistReaders | undefined;
  failed: boolean;
  scope: Scope;
}) {
  return (
    <nav
      className="wl-panel"
      aria-label="Wishlists"
      data-testid="wishlists-panel"
    >
      {data ? (
        <ReaderLinks data={data} scope={scope} />
      ) : failed ? (
        <p className="wl-panel-error">Couldn’t load the readers.</p>
      ) : (
        <PanelSkeleton />
      )}
    </nav>
  );
}

/**
 * The phone's title bar: the page heading, with a trigger over it that opens the panel's list
 * as a menu. On a wide screen the trigger and its menu are hidden and `children` is just the title.
 */
export function ReaderPicker({
  data,
  scope,
  children,
}: {
  data: WishlistReaders | undefined;
  scope: Scope;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const shown = data ? readerOf(scope, data.readers) : null;
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Escape bubbles up from the trigger or a link, which hold the focus
    <div
      className="wl-titlebar"
      onKeyDown={(e) => {
        if (e.key !== "Escape" || !open) return;
        setOpen(false);
        trigger.current?.focus();
      }}
    >
      <span className="wl-titlebar-icon" aria-hidden="true">
        {shown ? avatarOf(shown) : EVERYONE_ICON}
      </span>
      {children}
      <span className="wl-titlebar-caret" aria-hidden="true">
        ▾
      </span>
      <button
        ref={trigger}
        type="button"
        className="wl-picker-trigger"
        data-testid="wishlists-picker-trigger"
        aria-label="Choose whose wishlist to show"
        aria-expanded={open}
        aria-controls="wishlists-picker-menu"
        disabled={!data}
        onClick={() => setOpen(!open)}
      />
      {open && data && (
        <>
          {/* biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: a pointer-only backdrop; Escape already closes the menu */}
          <div
            className="wl-picker-scrim"
            data-testid="wishlists-picker-scrim"
            onClick={() => setOpen(false)}
          />
          <nav
            id="wishlists-picker-menu"
            className="wl-picker-menu"
            aria-label="Wishlists"
            data-testid="wishlists-picker-menu"
          >
            <ReaderLinks
              data={data}
              scope={scope}
              onChoose={() => setOpen(false)}
            />
          </nav>
        </>
      )}
    </div>
  );
}
