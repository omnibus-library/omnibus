import { useState } from "react";
import { Link, NavLink, useNavigate } from "react-router";
import brandMark from "../../assets/omnibus-stoat.png";
import { AddBookSheet } from "../../pages/AddBooks/AddBookSheet";
import { useCurrentUser } from "../../session";
import { Button } from "../Button/Button";
import { BookGlyph, HeartGlyph, UploadGlyph } from "../Glyphs/Glyphs";
import { MoreMenu, type MoreMenuItem } from "../MoreMenu/MoreMenu";
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
        <Link to="/" className="atrium-brand" aria-label="Omnibus">
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
          <AddMenu onUpload={user.canUpload ? () => setAdding(true) : null} />
          <UserMenu />
        </div>
      </nav>
      {adding && <AddBookSheet onClosed={() => setAdding(false)} />}
    </>
  );
}

/** The bar's one Add button and its menu of the ways a book comes in; `onUpload` is null for a reader who may not upload. */
function AddMenu({ onUpload }: { onUpload: (() => void) | null }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const items: MoreMenuItem[] = [
    ...(onUpload
      ? [
          {
            label: "Upload book files",
            testId: "add-menu-upload",
            icon: <UploadGlyph size={15} />,
            onSelect: onUpload,
          },
        ]
      : []),
    {
      label: "Add a copy you own",
      testId: "add-menu-copy",
      icon: <BookGlyph size={15} />,
      onSelect: () => navigate("/check-in", { state: { fromApp: true } }),
    },
    {
      label: "Add to your wishlist",
      testId: "add-menu-wishlist",
      icon: <HeartGlyph size={15} />,
      onSelect: () => navigate("/wishlists", { state: { add: true } }),
    },
  ];
  return (
    <div className="atrium-add">
      <Button
        variant="primary"
        size="sm"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        Add
      </Button>
      {open && (
        <MoreMenu label="Add" items={items} onClose={() => setOpen(false)} />
      )}
    </div>
  );
}
