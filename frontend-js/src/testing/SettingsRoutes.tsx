import { useState } from "react";
import { createMemoryRouter, RouterProvider, useLocation } from "react-router";
import { expect, waitFor } from "storybook/test";
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

/** Waits for an always-mounted status line to say `text`: it fills in a moment after the action. */
export const said = (
  canvas: { getByTestId: (id: string) => HTMLElement },
  testId: string,
  text: string,
) => waitFor(() => expect(canvas.getByTestId(testId)).toHaveTextContent(text));
