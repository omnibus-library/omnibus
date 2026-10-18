import { createBrowserRouter, Navigate, type RouteObject } from "react-router";
import { AppShell } from "./layouts/AppShell";
import { RequireAuth } from "./layouts/RequireAuth";
import { Account } from "./pages/Account/Account";
import { AddBooks } from "./pages/AddBooks/AddBooks";
import { AdminHealth } from "./pages/AdminHealth/AdminHealth";
import { AuthorDetail } from "./pages/AuthorDetail/AuthorDetail";
import { Authors } from "./pages/Authors/Authors";
import { BookDetail } from "./pages/BookDetail/BookDetail";
import { BookEdit } from "./pages/BookEdit/BookEdit";
import { CheckIn } from "./pages/CheckIn/CheckIn";
import { CleanupReview } from "./pages/CleanupReview/CleanupReview";
import { ComicReader } from "./pages/ComicReader/ComicReader";
import { Connect } from "./pages/Connect/Connect";
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

// Mirrors frontend/src/routes.rs: the readers and the player fill the screen,
// everything else sits under the top bar.
export const routes: RouteObject[] = [
  { path: "/login", element: <Login /> },
  { path: "/register", element: <Register /> },
  { path: "/connect", element: <Connect /> },
  {
    element: <RequireAuth />,
    children: [
      { path: "/read/:uuid", element: <Reader /> },
      { path: "/comic/:uuid", element: <ComicReader /> },
      { path: "/pdf/:uuid", element: <PdfReader /> },
      { path: "/listen/:uuid", element: <Listen /> },
      {
        path: "/logs",
        element: <Navigate to="/settings?section=logs" replace />,
      },
      {
        element: <AppShell />,
        children: [
          { path: "/", element: <Library /> },
          { path: "/books/:uuid", element: <BookDetail /> },
          { path: "/books/:uuid/edit", element: <BookEdit /> },
          { path: "/authors", element: <Authors /> },
          { path: "/authors/:id", element: <AuthorDetail /> },
          { path: "/series", element: <Series /> },
          { path: "/series/:id", element: <SeriesDetail /> },
          { path: "/stats", element: <Stats /> },
          { path: "/stats/chart", element: <StatsChart /> },
          { path: "/shelves", element: <Shelves /> },
          { path: "/shelves/:id", element: <ShelfDetail /> },
          { path: "/search", element: <Search /> },
          { path: "/search/:query", element: <Search /> },
          { path: "/settings", element: <Settings /> },
          { path: "/settings/cleanup/:kind", element: <CleanupReview /> },
          { path: "/admin/health", element: <AdminHealth /> },
          { path: "/account", element: <Account /> },
          { path: "/add-books", element: <AddBooks /> },
          { path: "/check-in", element: <CheckIn /> },
          { path: "*", element: <NotFound /> },
        ],
      },
    ],
  },
];

export const router = createBrowserRouter(routes);
