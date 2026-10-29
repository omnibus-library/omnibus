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
import { classes } from "../../classes";
import {
  usePlayback,
  useReleasePlayback,
} from "../../playback/PlaybackProvider";
import { resumeHref } from "../../resume";
import { useCurrentUser, useReturnToAdmin, useSignOut } from "../../session";
import { PEOPLE_HREF } from "../../settingsIndex";
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
import { minutesLeft } from "./impersonation";
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
        className={classes(
          "um-trigger",
          user.impersonation && "um-trigger-impersonating",
        )}
        data-testid="user-menu-trigger"
        aria-label={
          user.impersonation
            ? `Open user menu, viewing as ${user.name}`
            : "Open user menu"
        }
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <UserAvatar
          user={user}
          className="um-initials"
          photoClassName="um-initials-photo"
        />
        {user.impersonation && (
          <span className="um-trigger-dot" aria-hidden="true" />
        )}
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
          <ImpersonationStrip user={user} />
          <Identity user={user} onNavigate={close} />
          <NowReading onNavigate={close} />
          <AccountRows user={user} onNavigate={close} />
          <SessionRows user={user} onNavigate={close} />
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

// Who is really signed in, and how long the impersonation has left.
function ImpersonationStrip({ user }: { user: User }) {
  const { impersonation } = user;
  if (!impersonation) return null;
  return (
    <div className="um-impersonating" data-testid="user-menu-impersonating">
      <div className="um-impersonating-label">Viewing as {user.name}</div>
      <div className="um-impersonating-by">
        Signed in as {impersonation.impersonatorName} · ends in{" "}
        {minutesLeft(impersonation.expiresAt, Date.now())} min
      </div>
    </div>
  );
}

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

type SwitchRowProps = SectionProps & {
  returnToAdmin: ReturnType<typeof useReturnToAdmin>;
  /** Another change of session is under way. */
  disabled: boolean;
};

// Admins switch user from the People page; while impersonating, the row returns to the admin instead.
function SwitchRow({
  user,
  onNavigate,
  returnToAdmin,
  disabled,
}: SwitchRowProps) {
  if (user.impersonation) {
    return (
      <>
        <button
          type="button"
          className="um-row um-row-accent"
          data-testid="user-menu-return"
          onClick={() =>
            returnToAdmin.mutate(undefined, { onSuccess: onNavigate })
          }
          disabled={disabled || returnToAdmin.isPending}
          aria-busy={returnToAdmin.isPending}
        >
          <span className="um-row-icon" aria-hidden="true">
            ⇄
          </span>
          <span className="um-row-label">
            Return to {user.impersonation.impersonatorName}
          </span>
        </button>
        {returnToAdmin.isError && (
          <div className="um-now-reading-state error" role="alert">
            Return failed: {returnToAdmin.error.message}
          </div>
        )}
      </>
    );
  }
  return user.isAdmin ? (
    <Link
      to={PEOPLE_HREF}
      className="um-row"
      data-testid="user-menu-switch-user"
      onClick={onNavigate}
    >
      <span className="um-row-icon" aria-hidden="true">
        ⇄
      </span>
      <span className="um-row-label">Switch user</span>
    </Link>
  ) : null;
}

function SessionRows({ user, onNavigate }: SectionProps) {
  const { flush } = usePlayback();
  const release = useReleasePlayback();
  // A switch of account must not leave the player writing to the other account.
  const returnToAdmin = useReturnToAdmin(release);
  const signOut = useSignOut(user.impersonation ? release : flush);
  return (
    <div className="um-rows">
      <SwitchRow
        user={user}
        onNavigate={onNavigate}
        returnToAdmin={returnToAdmin}
        disabled={signOut.isPending}
      />
      <button
        type="button"
        className="um-row destructive"
        data-testid="logout-button"
        onClick={() => signOut.mutate(undefined, { onSuccess: onNavigate })}
        disabled={signOut.isPending || returnToAdmin.isPending}
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
