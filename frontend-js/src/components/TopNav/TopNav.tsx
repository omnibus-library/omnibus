import { Link, NavLink } from "react-router";
import brandMark from "../../assets/omnibus-stoat.png";
import { useCurrentUser, useSignOut } from "../../session";
import { Button } from "../Button/Button";
import { BusyLabel } from "../Loading/Loading";
import "./TopNav.css";

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
        <NavLink to="/" end className={onWhenActive}>
          Library
        </NavLink>
      </div>
      <div className="atrium-actions">
        <span className="label">{user.name}</span>
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
