import {
  queryOptions,
  type UseQueryResult,
  useQuery,
} from "@tanstack/react-query";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import {
  fetchRecentProgress,
  type ResumePoint,
  thumbUrl,
  type User,
} from "../../api";
import { resumeHref } from "../../resume";
import { useCurrentUser, useSignOut } from "../../session";
import { Cover } from "../Cover/Cover";
import {
  BookGlyph,
  PlayGlyph,
  ServerGlyph,
  SlidersGlyph,
} from "../Glyphs/Glyphs";
import { Skeleton } from "../Loading/Loading";
import { ThemePicker } from "../ThemePicker/ThemePicker";
import { UserAvatar } from "../UserAvatar/UserAvatar";
import "./UserMenu.css";

/** The top bar's account menu: who is signed in, where to go, and the theme. */
export function UserMenu() {
  const user = useCurrentUser();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const close = () => setOpen(false);
  // Focus the panel so Escape reaches its key handler.
  useEffect(() => {
    if (open) panel.current?.focus();
  }, [open]);
  const dismiss = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    close();
    trigger.current?.focus();
  };
  return (
    <div className="um-root">
      <button
        ref={trigger}
        type="button"
        className="um-trigger"
        data-testid="user-menu-trigger"
        aria-label="Open user menu"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <UserAvatar
          user={user}
          className="um-initials"
          photoClassName="um-initials-photo"
        />
      </button>
      {open && (
        <div
          className="um-scrim"
          data-testid="user-menu-scrim"
          aria-hidden="true"
          onClick={close}
        />
      )}
      {open && (
        <div
          className="um-panel"
          data-testid="user-menu-panel"
          role="dialog"
          aria-label="User menu"
          tabIndex={-1}
          ref={panel}
          onKeyDown={dismiss}
        >
          <Identity user={user} onNavigate={close} />
          <NowReading onNavigate={close} />
          <AccountRows user={user} onNavigate={close} />
          <SessionRows />
          <div className="um-theme">
            <div className="um-section-label">THEME</div>
            <ThemePicker />
          </div>
          <div className="um-version" data-testid="user-menu-version">
            {__APP_VERSION__}
          </div>
        </div>
      )}
    </div>
  );
}

type NavigateProps = { onNavigate: () => void };
type SectionProps = NavigateProps & { user: User };

// The handle stays the username: the stable login, where a display name can change or collide.
function Identity({ user, onNavigate }: SectionProps) {
  return (
    <div className="um-header">
      <div className="um-avatar um-avatar-lg">
        <UserAvatar
          user={user}
          className="um-initials"
          photoClassName="um-initials-photo"
        />
      </div>
      <div className="um-identity">
        <div className="um-name">{user.name}</div>
        <div className="um-handle">
          {user.username}@local ·{" "}
          <span className="um-role">{user.isAdmin ? "Owner" : "Member"}</span>
        </div>
      </div>
      <Link
        className="um-edit"
        to="/settings?section=profile"
        onClick={onNavigate}
      >
        Edit
      </Link>
    </div>
  );
}

const recentQuery = queryOptions({
  queryKey: ["progress", "recent", 1],
  queryFn: () => fetchRecentProgress(1),
});

// The most recent position across reading and listening.
function NowReading({ onNavigate }: NavigateProps) {
  const recent = useQuery(recentQuery);
  return (
    <div className="um-section">
      <div className="um-section-label">NOW READING</div>
      <NowReadingBody recent={recent} onNavigate={onNavigate} />
    </div>
  );
}

type NowReadingBodyProps = NavigateProps & {
  recent: UseQueryResult<ResumePoint[]>;
};

function NowReadingBody({ recent, onNavigate }: NowReadingBodyProps) {
  switch (recent.status) {
    case "pending":
      return (
        <div
          className="um-now-reading um-now-reading-pending"
          role="status"
          data-testid="user-menu-now-reading-pending"
        >
          <span className="ld-sr">Finding your place</span>
          <span className="um-nr-cover">
            <Skeleton shape="cover" />
          </span>
          <span className="um-nr-meta">
            <Skeleton style={{ "--w": "70%" }} />
            <Skeleton style={{ "--w": "45%", height: ".7em" }} />
          </span>
        </div>
      );
    case "error":
      return (
        <div className="um-now-reading um-now-reading-state error" role="alert">
          Unable to load reading progress.
        </div>
      );
    case "success": {
      const [point] = recent.data;
      return point ? (
        <ResumeRow point={point} onNavigate={onNavigate} />
      ) : (
        <div className="um-now-reading um-now-reading-state">
          Nothing in progress
        </div>
      );
    }
    default: {
      const _exhaustive: never = recent;
      return _exhaustive;
    }
  }
}

type ResumeRowProps = NavigateProps & { point: ResumePoint };

function ResumeRow({ point, onNavigate }: ResumeRowProps) {
  const { book } = point;
  const listening = point.format === "audio";
  const action = listening ? "Continue listening" : "Continue reading";
  const author = book.authors[0]?.trim();
  const detail = `/books/${book.uuid}`;
  return (
    <div className="um-now-reading" data-testid="user-menu-now-reading">
      <Link
        to={detail}
        className="um-nr-cover"
        aria-label={`View details for ${book.title}`}
        onClick={onNavigate}
      >
        <Cover book={book} src={book.hasCover ? thumbUrl(book.uuid) : null} />
      </Link>
      <div className="um-nr-meta">
        <Link to={detail} className="um-nr-info" onClick={onNavigate}>
          <div className="um-nr-title">{book.title}</div>
          {author && <div className="um-nr-author">{author}</div>}
        </Link>
        <div className="um-nr-action">{action}</div>
      </div>
      <Link
        to={resumeHref(point)}
        className="um-nr-play"
        data-testid="user-menu-now-reading-action"
        aria-label={`${action} ${book.title}`}
        onClick={onNavigate}
      >
        {listening ? <PlayGlyph /> : <BookGlyph />}
      </Link>
    </div>
  );
}

// Personal settings for everyone; server administration for admins only.
function AccountRows({ user, onNavigate }: SectionProps) {
  return (
    <div className="um-rows">
      <Link to="/settings" className="um-row" onClick={onNavigate}>
        <span className="um-row-icon">
          <SlidersGlyph />
        </span>
        <span className="um-row-label">Settings</span>
      </Link>
      {user.isAdmin && (
        <Link
          to="/admin"
          className="um-row"
          data-testid="user-menu-admin"
          onClick={onNavigate}
        >
          <span className="um-row-icon">
            <ServerGlyph />
          </span>
          <span className="um-row-label">Administration</span>
        </Link>
      )}
    </div>
  );
}

// "Switch user" has nowhere to go yet, so it renders inert rather than as a dead link.
function SessionRows() {
  const signOut = useSignOut();
  return (
    <div className="um-rows">
      <div className="um-row" aria-disabled="true">
        <span className="um-row-icon" aria-hidden="true">
          ⇄
        </span>
        <span className="um-row-label">Switch user</span>
      </div>
      <button
        type="button"
        className="um-row destructive"
        data-testid="logout-button"
        onClick={() => signOut.mutate()}
        disabled={signOut.isPending}
        aria-busy={signOut.isPending}
      >
        <span className="um-row-icon" aria-hidden="true">
          ⏻
        </span>
        <span className="um-row-label">Sign out</span>
      </button>
      {signOut.isError && (
        <div className="um-now-reading-state error" role="alert">
          Sign out failed: {signOut.error.message}
        </div>
      )}
    </div>
  );
}
