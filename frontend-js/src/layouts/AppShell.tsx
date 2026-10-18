import { Outlet } from "react-router";
import { TopNav } from "../components/TopNav/TopNav";
import "./AppShell.css";

/** The signed-in frame: the top bar over the routed page. */
export function AppShell() {
  return (
    <div className="app-shell">
      <TopNav />
      <main>
        <Outlet />
      </main>
    </div>
  );
}
