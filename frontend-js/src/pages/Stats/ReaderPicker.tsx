import { useState } from "react";
import { Link } from "react-router";
import type { HouseholdReader, UserId } from "../../api";
import { UserAvatar } from "../../components/UserAvatar/UserAvatar";
import { showsPicker, viewing } from "./picker";

const avatarOf = (reader: HouseholdReader) => (
  <span aria-hidden="true">
    <UserAvatar
      user={{
        id: reader.id as UserId,
        name: reader.name,
        hasAvatar: reader.has_avatar,
      }}
      className="st-reader-avatar"
      photoClassName="st-reader-avatar-photo"
    />
  </span>
);

/** The household dropdown: a trigger naming whose stats are shown, and a menu of every reader sharing theirs. */
export function ReaderPicker({
  readers,
  selected,
}: {
  readers: readonly HouseholdReader[];
  selected: UserId | null;
}) {
  const [open, setOpen] = useState(false);
  if (!showsPicker(readers)) return null;

  const current = viewing(selected, readers);
  const name = current.kind === "you" ? "You" : current.name;
  // An unlisted id shows no avatar.
  const shown =
    selected === null
      ? readers.find((r) => r.is_you)
      : readers.find((r) => r.id === selected);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Escape bubbles up from the trigger or an option, which hold the focus
    <div
      className="st-reader-bar"
      data-testid="stats-reader-picker"
      onKeyDown={(e) => {
        if (e.key === "Escape") setOpen(false);
      }}
    >
      <button
        type="button"
        className="st-reader-trigger"
        data-testid="stats-reader-trigger"
        aria-expanded={open}
        aria-controls="stats-reader-menu"
        // The kicker, avatar and name are separate spans, so the name is stated rather than concatenated.
        aria-label={`Stats for ${name}`}
        onClick={() => setOpen(!open)}
      >
        <span className="st-reader-kicker">Stats for</span>
        {shown && avatarOf(shown)}
        <span className="st-reader-name">{name}</span>
        <span aria-hidden="true" className="st-reader-caret">
          ▾
        </span>
      </button>
      <ul
        id="stats-reader-menu"
        className="st-reader-menu"
        data-testid="stats-reader-menu"
        hidden={!open}
      >
        {readers.map((reader) => {
          const here = reader.is_you
            ? selected === null
            : selected === reader.id;
          return (
            <li key={reader.id}>
              <Link
                className="st-reader-option"
                data-testid={
                  reader.is_you
                    ? "stats-reader-option-you"
                    : `stats-reader-option-${reader.id}`
                }
                to={reader.is_you ? "/stats" : `/stats?user=${reader.id}`}
                aria-current={here ? "page" : "false"}
                onClick={() => setOpen(false)}
              >
                {avatarOf(reader)}
                <span className="st-reader-option-name">
                  {reader.is_you ? "You" : reader.name}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      {open && (
        // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: a pointer-only backdrop; Escape already closes the menu
        <div
          className="st-reader-scrim"
          data-testid="stats-reader-scrim"
          onClick={() => setOpen(false)}
        />
      )}
    </div>
  );
}
