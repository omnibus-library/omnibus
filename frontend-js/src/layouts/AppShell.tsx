import { Outlet } from "react-router";
import {
  SearchPaletteOverlay,
  SearchPaletteProvider,
} from "../components/SearchPalette/SearchPalette";
import { TopNav } from "../components/TopNav/TopNav";
import "./AppShell.css";

/** The signed-in frame: the top bar over the routed page, and the search palette. */
export function AppShell() {
  return (
    <SearchPaletteProvider>
      <div className="app-shell">
        <TopNav />
        <main>
          <Outlet />
        </main>
        <SearchPaletteOverlay />
      </div>
    </SearchPaletteProvider>
  );
}
