import { Outlet } from "react-router";
import { dockBook } from "../pages/Listen/listenView";
import { MiniDock } from "../pages/Listen/MiniDock";
import { usePlayback } from "../playback/PlaybackProvider";
import "./ReaderDock.css";

/** The full-screen readers, with the audiobook dock docked beneath; `rd-immersive` reflows the stage above it while it shows. */
export function ReaderDock() {
  const playback = usePlayback();
  return (
    <div
      className={
        dockBook(playback)
          ? "rd-host rd-dock-full rd-immersive"
          : "rd-host rd-dock-full"
      }
    >
      <Outlet />
      <MiniDock />
    </div>
  );
}
