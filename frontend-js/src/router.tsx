import { createBrowserRouter } from "react-router";
import { AppShell } from "./layouts/AppShell";
import { RequireAuth } from "./layouts/RequireAuth";
import { BookDetail } from "./pages/BookDetail/BookDetail";
import { Library } from "./pages/Library/Library";
import { Login } from "./pages/Login/Login";

export const router = createBrowserRouter([
  { path: "/login", element: <Login /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppShell />,
        children: [
          { path: "/", element: <Library /> },
          { path: "/books/:uuid", element: <BookDetail /> },
        ],
      },
    ],
  },
]);
