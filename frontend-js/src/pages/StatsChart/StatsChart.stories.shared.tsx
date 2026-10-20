import { Route, Routes } from "react-router";
import { storyApi } from "../../testing/statsHandlers";
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

/** The fake API with `calls` cleared; `calls` is what it saw since the story began. */
export const { calls, api } = storyApi();
