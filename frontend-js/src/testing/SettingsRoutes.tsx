import { useState } from "react";
import { createMemoryRouter, RouterProvider, useLocation } from "react-router";
import { Settings } from "../pages/Settings/Settings";

// Where a link out of the page lands, naming the place so a play can assert it.
function Elsewhere() {
  const { pathname, search } = useLocation();
  return <p>{`Landed on ${pathname}${search}`}</p>;
}

/** `/settings` at `path` in a data router (the leave guard needs one), with a stub for every route a link leaves to. */
export function SettingsRoutes({ path = "/settings" }: { path?: string }) {
  const [router] = useState(() =>
    createMemoryRouter(
      [
        { path: "/settings", element: <Settings /> },
        { path: "*", element: <Elsewhere /> },
      ],
      { initialEntries: [path] },
    ),
  );
  return <RouterProvider router={router} />;
}
