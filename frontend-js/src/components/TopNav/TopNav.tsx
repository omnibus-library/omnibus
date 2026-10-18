import { Link, NavLink } from "react-router";
import brandMark from "../../assets/omnibus-stoat.png";
import { useCurrentUser, useSignOut } from "../../session";
import { Button, ButtonLink } from "../Button/Button";
import { BusyLabel } from "../Loading/Loading";
import "./TopNav.css";

const SECTIONS = [
  { to: "/", label: "Library", end: true },
  { to: "/authors", label: "Authors", end: false },
  { to: "/series", label: "Series", end: false },
  { to: "/stats", label: "Stats", end: false },
];

const onWhenActive = ({ isActive }: { isActive: boolean }) =>
  isActive ? "on" : "";

/** The desktop top bar: brand, the primary sections, and the account actions. */
export function TopNav() {
  const user = useCurrentUser();
  const signOut = useSignOut();
  return (
    <nav className="atrium-topbar" aria-label="Primary">
      <Link to="/" className="atrium-brand">
        <img className="atrium-brand-mark" src={brandMark} alt="" />
        <div className="atrium-brand-word">Omnibus</div>
      </Link>
      <div className="atrium-nav">
        {SECTIONS.map((section) => (
          <NavLink
            key={section.to}
            to={section.to}
            end={section.end}
            className={onWhenActive}
          >
            {section.label}
          </NavLink>
        ))}
      </div>
      <div className="atrium-actions">
        <ButtonLink to="/search" variant="ghost" size="sm">
          Search
        </ButtonLink>
        <ButtonLink to="/check-in" size="sm">
          Check in
        </ButtonLink>
        {user.canUpload && (
          <ButtonLink to="/add-books" variant="primary" size="sm">
            Add books
          </ButtonLink>
        )}
        <Link to="/account" className="label">
          {user.name}
        </Link>
        <ButtonLink to="/settings" variant="ghost" size="sm">
          Settings
        </ButtonLink>
        <Button
          size="sm"
          onClick={() => signOut.mutate()}
          disabled={signOut.isPending}
          aria-busy={signOut.isPending}
        >
          <BusyLabel
            busy={signOut.isPending}
            label="Sign out"
            busyLabel="Signing out…"
          />
        </Button>
        {signOut.isError && (
          <span role="alert">Sign out failed: {signOut.error.message}</span>
        )}
      </div>
    </nav>
  );
}
