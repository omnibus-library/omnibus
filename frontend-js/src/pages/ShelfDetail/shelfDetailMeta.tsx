import type { Meta } from "@storybook/react-vite";
import { Route, Routes } from "react-router";
import {
  LIBRARY_PATH,
  type ShelfWrite,
  shelfDetailHandlers,
  shelvesHandler,
} from "../../testing/handlers";
import {
  aWireBook,
  aWireShelfDetail,
  uuidOf,
  WIRE_ADA,
} from "../../testing/wire";
import { ShelfDetail } from "./ShelfDetail";

export const BOB = { owner_user_id: 2, owner_username: "bob" };
export const NOT_ADMIN = { ...WIRE_ADA, is_admin: false };

// Two by Ada, one by Sora, so a filter has something to rule out.
export const MEMBERS = [1, 2, 3].map((n) =>
  aWireBook({
    id: n,
    title: `Winter book ${n}`,
    unique_identifier: uuidOf(n),
    cover_url: `/api/covers/${uuidOf(n)}`,
    creators: [
      {
        name: n < 3 ? "Ada Lovelace" : "Sora Inkwell",
        role: null,
        file_as: null,
        id: n,
      },
    ],
  }),
);

export const LIBRARY_KEY = "omnibus.view_prefs.last_library";
export const PREFS_KEY = `omnibus.view_prefs::${LIBRARY_PATH}`;

export const writes: ShelfWrite[] = [];

/** What both ShelfDetail story files share; each adds its own `title`. */
export const shelfDetailMeta = {
  component: ShelfDetail,
  parameters: { path: "/shelves/3" },
  beforeEach({ msw }) {
    writes.length = 0;
    localStorage.removeItem(LIBRARY_KEY);
    localStorage.removeItem(PREFS_KEY);
    msw.use(
      shelvesHandler([]),
      ...shelfDetailHandlers(aWireShelfDetail(), MEMBERS, writes),
    );
  },
  render: () => (
    <Routes>
      <Route path="/shelves/:id" element={<ShelfDetail />} />
      <Route path="/shelves" element={<p>The shelves index</p>} />
    </Routes>
  ),
} satisfies Meta<typeof ShelfDetail>;
