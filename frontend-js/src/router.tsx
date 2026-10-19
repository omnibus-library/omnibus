import { createBrowserRouter, Navigate, type RouteObject } from "react-router";
import { RouteError } from "./components/RouteError/RouteError";
import { AppShell } from "./layouts/AppShell";
import { ReaderDock } from "./layouts/ReaderDock";
import { RequireAuth } from "./layouts/RequireAuth";
import { Account } from "./pages/Account/Account";
import { AddBooks } from "./pages/AddBooks/AddBooks";
import { Admin } from "./pages/Admin/Admin";
import { AdminHealth } from "./pages/AdminHealth/AdminHealth";
import { AuthorDetail } from "./pages/AuthorDetail/AuthorDetail";
import { Authors, AuthorsIndexPane } from "./pages/Authors/Authors";
import { BookDetail } from "./pages/BookDetail/BookDetail";
import { BookEdit } from "./pages/BookEdit/BookEdit";
import { CheckIn } from "./pages/CheckIn/CheckIn";
import { CleanupReview } from "./pages/CleanupReview/CleanupReview";
import { ComicReader } from "./pages/ComicReader/ComicReader";
import { Library } from "./pages/Library/Library";
import { Listen } from "./pages/Listen/Listen";
import { Login } from "./pages/Login/Login";
import { NotFound } from "./pages/NotFound/NotFound";
import { PdfReader } from "./pages/PdfReader/PdfReader";
import { Reader } from "./pages/Reader/Reader";
import { Register } from "./pages/Register/Register";
import { Search } from "./pages/Search/Search";
import { Series } from "./pages/Series/Series";
import { SeriesDetail } from "./pages/SeriesDetail/SeriesDetail";
import { Settings } from "./pages/Settings/Settings";
import { ShelfDetail } from "./pages/ShelfDetail/ShelfDetail";
import { Shelves } from "./pages/Shelves/Shelves";
import { Stats } from "./pages/Stats/Stats";
import { StatsChart } from "./pages/StatsChart/StatsChart";

// Mirrors frontend/src/routes.rs: the readers (with the audiobook dock beneath) and the player fill the screen,
// everything else sits under the top bar. Two error boundaries: one inside the
// shell, so a page that throws keeps the top bar, and one at the root for
// everything else (the session gate, the shell itself, the readers).
export const routes: RouteObject[] = [
  {
    errorElement: <RouteError />,
    children: [
      { path: "/login", element: <Login /> },
      { path: "/register", element: <Register /> },
      // The native shell's server picker; a browser is already on its server.
      { path: "/connect", element: <Navigate to="/" replace /> },
      {
        element: <RequireAuth />,
        children: [
          {
            element: <ReaderDock />,
            children: [
              { path: "/read/:uuid", element: <Reader /> },
              { path: "/comic/:uuid", element: <ComicReader /> },
              { path: "/pdf/:uuid", element: <PdfReader /> },
            ],
          },
          { path: "/listen/:uuid", element: <Listen /> },
          {
            path: "/logs",
            element: <Navigate to="/settings?section=logs" replace />,
          },
          {
            element: <AppShell />,
            children: [
              {
                errorElement: <RouteError />,
                children: [
                  { path: "/", element: <Library /> },
                  { path: "/books/:uuid", element: <BookDetail /> },
                  { path: "/books/:uuid/edit", element: <BookEdit /> },
                  {
                    path: "/authors",
                    element: <Authors />,
                    children: [
                      { index: true, element: <AuthorsIndexPane /> },
                      { path: ":id", element: <AuthorDetail /> },
                    ],
                  },
                  { path: "/series", element: <Series /> },
                  { path: "/series/:id", element: <SeriesDetail /> },
                  { path: "/stats", element: <Stats /> },
                  { path: "/stats/chart", element: <StatsChart /> },
                  { path: "/shelves", element: <Shelves /> },
                  { path: "/shelves/:id", element: <ShelfDetail /> },
                  // Web search is the palette; only /search/:query is a page.
                  { path: "/search", element: <Navigate to="/" replace /> },
                  { path: "/search/:query", element: <Search /> },
                  { path: "/settings", element: <Settings /> },
                  {
                    path: "/settings/cleanup/:kind",
                    element: <CleanupReview />,
                  },
                  { path: "/admin", element: <Admin /> },
                  {
                    path: "/admin/cleanup/:kind",
                    element: <CleanupReview />,
                  },
                  { path: "/admin/health", element: <AdminHealth /> },
                  { path: "/account", element: <Account /> },
                  { path: "/add-books", element: <AddBooks /> },
                  { path: "/check-in", element: <CheckIn /> },
                  { path: "*", element: <NotFound /> },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
];

// `vite build --base=/react/` for Axum, `/` under the dev server and Storybook.
const basename = import.meta.env.BASE_URL.replace(/\/$/, "") || "/";

export const router = createBrowserRouter(routes, { basename });
