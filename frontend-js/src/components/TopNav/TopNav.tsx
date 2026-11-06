import { type RefObject, useRef, useState } from "react";
import { Link, NavLink, useNavigate } from "react-router";
import brandMark from "../../assets/omnibus-stoat.png";
import { AddBookSheet } from "../../pages/AddBooks/AddBookSheet";
import { useCurrentUser } from "../../session";
import { Button } from "../Button/Button";
import {
  ChevronDownGlyph,
  HeartGlyph,
  ScanGlyph,
  UploadGlyph,
} from "../Glyphs/Glyphs";
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
  const addButton = useRef<HTMLButtonElement>(null);
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
          <AddMenu
            button={addButton}
            onUpload={user.canUpload ? () => setAdding(true) : null}
          />
          <UserMenu />
        </div>
      </nav>
      {adding && (
        // The menu item that opened the sheet is gone by the time it closes.
        <AddBookSheet
          fallbackFocus={addButton}
          onClosed={() => setAdding(false)}
        />
      )}
    </>
  );
}

/** The bar's one Add button and its menu of the ways a book comes in; `onUpload` is null for a reader who may not upload. */
function AddMenu({
  button,
  onUpload,
}: {
  button: RefObject<HTMLButtonElement | null>;
  onUpload: (() => void) | null;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const items: MoreMenuItem[] = [
    ...(onUpload
      ? [
          {
            label: "Upload book files",
            description: "EPUB, PDF, CBZ, M4B or MP3 from this computer",
            testId: "add-menu-upload",
            icon: <UploadGlyph size={20} />,
            onSelect: onUpload,
          },
        ]
      : []),
    {
      label: "Add a copy you own",
      description: "Scan or type the ISBN of a print book",
      testId: "add-menu-copy",
      icon: <ScanGlyph size={20} />,
      onSelect: () => navigate("/check-in", { state: { fromApp: true } }),
    },
    {
      label: "Add to your wishlist",
      description: "A book you’d like the household to find",
      testId: "add-menu-wishlist",
      icon: <HeartGlyph size={20} />,
      onSelect: () => navigate("/wishlists", { state: { add: true } }),
    },
  ];
  return (
    <div className="atrium-add">
      <Button
        ref={button}
        variant="primary"
        size="sm"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        Add
        <ChevronDownGlyph size={8} />
      </Button>
      {open && (
        <MoreMenu label="Add" items={items} onClose={() => setOpen(false)} />
      )}
    </div>
  );
}
