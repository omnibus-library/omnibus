import { Route, Routes } from "react-router";
import { noStatsCalls, statsHandlers } from "../../testing/statsHandlers";
import { StatsChart } from "./StatsChart";

// Shared by the StatsChart story files; the name keeps it out of the `*.stories.tsx` glob.

/** The page, with a stand-in for where its error link leaves to. */
export function Page() {
  return (
    <Routes>
      <Route path="/stats/chart" element={<StatsChart />} />
      <Route path="/stats" element={<h1>Stats</h1>} />
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
  return statsHandlers({ ...options, calls });
}
