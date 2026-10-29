import { useState } from "react";
import { Link, NavLink } from "react-router";
import brandMark from "../../assets/omnibus-stoat.png";
import { AddBookSheet } from "../../pages/AddBooks/AddBookSheet";
import { useCurrentUser } from "../../session";
import { Button, ButtonLink } from "../Button/Button";
import { SearchPaletteTrigger } from "../SearchPalette/SearchPalette";
import { UserMenu } from "../UserMenu/UserMenu";
import "./TopNav.css";

const SECTIONS = [
  { to: "/", label: "Library", end: true },
  { to: "/shelves", label: "Shelves", end: false },
  { to: "/authors", label: "Authors", end: false },
  { to: "/series", label: "Series", end: false },
  { to: "/stats", label: "Stats", end: false },
];

const onWhenActive = ({ isActive }: { isActive: boolean }) =>
  isActive ? "on" : "";

/** The desktop top bar: brand, the primary sections, and the account actions. */
export function TopNav() {
  const user = useCurrentUser();
  const [adding, setAdding] = useState(false);
  return (
    <>
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
        <SearchPaletteTrigger />
        <div className="atrium-actions">
          <ButtonLink to="/check-in" state={{ fromApp: true }} size="sm">
            Check in
          </ButtonLink>
          {user.canUpload && (
            <Button variant="primary" size="sm" onClick={() => setAdding(true)}>
              Add books
            </Button>
          )}
          <UserMenu />
        </div>
      </nav>
      {adding && <AddBookSheet onClosed={() => setAdding(false)} />}
    </>
  );
}
