import { Route, Routes } from "react-router";
import {
  aWireReader,
  noStatsCalls,
  statsHandlers,
} from "../../testing/statsHandlers";
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
    </Routes>
  );
}

/** What the fake API saw since the story began. */
export const calls = noStatsCalls();

/** The fake API with `calls` cleared; `options` choose its answers. */
export function api(
  options: Omit<NonNullable<Parameters<typeof statsHandlers>[0]>, "calls"> = {},
) {
  Object.assign(calls, noStatsCalls());
  return statsHandlers({ readers: READERS, ...options, calls });
}
