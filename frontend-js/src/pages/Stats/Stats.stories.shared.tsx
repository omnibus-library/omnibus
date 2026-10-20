import { Route, Routes } from "react-router";
import { aWireReader, storyApi } from "../../testing/statsHandlers";
import { Stats } from "./Stats";

// Shared by the Stats story files; the name keeps it out of the `*.stories.tsx` glob.

/** The caller, and Grace, who shares her stats. */
export const READERS = [
  aWireReader(),
  aWireReader({ id: 2, name: "Grace", is_you: false }),
];

/** The page, with stand-ins for where it leaves to. */
export function Page() {
  return (
    <Routes>
      <Route path="/stats" element={<Stats />} />
      <Route path="/" element={<h1>Library</h1>} />
      <Route path="/settings" element={<h1>Settings</h1>} />
    </Routes>
  );
}

/** The fake API with `calls` cleared, serving `READERS` unless a story says otherwise. */
export const { calls, api } = storyApi({ readers: READERS });
