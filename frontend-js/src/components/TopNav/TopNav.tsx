import { Link, NavLink } from "react-router";
import brandMark from "../../assets/omnibus-stoat.png";
import { useCurrentUser } from "../../session";
import { ButtonLink } from "../Button/Button";
import { SearchPaletteTrigger } from "../SearchPalette/SearchPalette";
import { UserMenu } from "../UserMenu/UserMenu";
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
      <SearchPaletteTrigger />
      <div className="atrium-actions">
        <ButtonLink to="/check-in" size="sm">
          Check in
        </ButtonLink>
        {user.canUpload && (
          <ButtonLink to="/add-books" variant="primary" size="sm">
            Add books
          </ButtonLink>
        )}
        <UserMenu />
      </div>
    </nav>
  );
}
