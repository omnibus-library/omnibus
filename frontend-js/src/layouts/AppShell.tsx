import { Outlet } from "react-router";
import {
  SearchPaletteOverlay,
  SearchPaletteProvider,
  useSearchPaletteOpen,
} from "../components/SearchPalette/SearchPalette";
import { TopNav } from "../components/TopNav/TopNav";
import { MiniDock } from "../pages/Listen/MiniDock";
import "./AppShell.css";

/** The signed-in frame: the top bar over the routed page, and the search palette. */
export function AppShell() {
  return (
    <SearchPaletteProvider>
      <ShellFrame />
      <SearchPaletteOverlay />
    </SearchPaletteProvider>
  );
}

// Inert under the open palette, so focus can't wander behind its scrim.
function ShellFrame() {
  return (
    <div className="app-shell" inert={useSearchPaletteOpen()}>
      <TopNav />
      <main>
        <Outlet />
      </main>
      <MiniDock />
    </div>
  );
}
