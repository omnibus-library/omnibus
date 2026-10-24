import { lazy, type ReactNode, Suspense } from "react";
import {
  createBrowserRouter,
  Navigate,
  type RouteObject,
  useParams,
} from "react-router";
import { Loading } from "./components/Loading/Loading";
import { RouteError } from "./components/RouteError/RouteError";
import { AppShell } from "./layouts/AppShell";
import { ReaderDock } from "./layouts/ReaderDock";
import { RequireAuth } from "./layouts/RequireAuth";
import { AddBooks } from "./pages/AddBooks/AddBooks";
import { AuthorDetail } from "./pages/AuthorDetail/AuthorDetail";
import { Authors, AuthorsIndexPane } from "./pages/Authors/Authors";
import { BookDetail } from "./pages/BookDetail/BookDetail";
import { BookEdit } from "./pages/BookEdit/BookEdit";
import { CheckIn } from "./pages/CheckIn/CheckIn";
import { Library } from "./pages/Library/Library";
import { Listen } from "./pages/Listen/Listen";
import { Login } from "./pages/Login/Login";
import { NotFound } from "./pages/NotFound/NotFound";
import { Register } from "./pages/Register/Register";
import { Search } from "./pages/Search/Search";
import { Series, SeriesIndexPane } from "./pages/Series/Series";
import { SeriesDetail } from "./pages/SeriesDetail/SeriesDetail";
import { ShelfDetail } from "./pages/ShelfDetail/ShelfDetail";
import { Shelves } from "./pages/Shelves/Shelves";
import { Stats } from "./pages/Stats/Stats";
import { StatsChart } from "./pages/StatsChart/StatsChart";

// Each reader, the settings page, Administration and the cleanup review is its own chunk, so the library never downloads one.
const Reader = lazy(() =>
  import("./pages/Reader/Reader").then((m) => ({ default: m.Reader })),
);
const ComicReader = lazy(() =>
  import("./pages/ComicReader/ComicReader").then((m) => ({
    default: m.ComicReader,
  })),
);
const PdfReader = lazy(() =>
  import("./pages/PdfReader/PdfReader").then((m) => ({ default: m.PdfReader })),
);

const Settings = lazy(() =>
  import("./pages/Settings/Settings").then((m) => ({ default: m.Settings })),
);

const Admin = lazy(() =>
  import("./pages/Admin/Admin").then((m) => ({ default: m.Admin })),
);

const CleanupReview = lazy(() =>
  import("./pages/CleanupReview/CleanupReview").then((m) => ({
    default: m.CleanupReview,
  })),
);

const chunk = (element: ReactNode, kind: "stage" | "page" = "stage") => (
  <Suspense fallback={<Loading kind={kind} />}>{element}</Suspense>
);

// The review queue's address before it moved under /admin.
function LegacyCleanupReview() {
  const { kind = "" } = useParams();
  return <Navigate to={`/admin/cleanup/${encodeURIComponent(kind)}`} replace />;
}

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
              { path: "/read/:uuid", element: chunk(<Reader />) },
              { path: "/comic/:uuid", element: chunk(<ComicReader />) },
              { path: "/pdf/:uuid", element: chunk(<PdfReader />) },
            ],
          },
          { path: "/listen/:uuid", element: <Listen /> },
          {
            path: "/logs",
            element: <Navigate to="/admin?section=logs" replace />,
          },
          {
            element: <AppShell />,
            children: [
              {
                errorElement: <RouteError />,
                children: [
                  { path: "/", element: <Library /> },
                  {
                    path: "/books/:uuid",
                    element: <BookDetail />,
                    // The editor is a sheet over the book page, which stays mounted beneath it.
                    children: [{ path: "edit", element: <BookEdit /> }],
                  },
                  {
                    path: "/authors",
                    element: <Authors />,
                    children: [
                      { index: true, element: <AuthorsIndexPane /> },
                      { path: ":id", element: <AuthorDetail /> },
                    ],
                  },
                  {
                    path: "/series",
                    element: <Series />,
                    children: [
                      { index: true, element: <SeriesIndexPane /> },
                      { path: ":id", element: <SeriesDetail /> },
                    ],
                  },
                  { path: "/stats", element: <Stats /> },
                  { path: "/stats/chart", element: <StatsChart /> },
                  { path: "/shelves", element: <Shelves /> },
                  { path: "/shelves/:id", element: <ShelfDetail /> },
                  // Web search is the palette; only /search/:query is a page.
                  { path: "/search", element: <Navigate to="/" replace /> },
                  { path: "/search/:query", element: <Search /> },
                  { path: "/settings", element: chunk(<Settings />, "page") },
                  {
                    path: "/settings/cleanup/:kind",
                    element: <LegacyCleanupReview />,
                  },
                  { path: "/admin", element: chunk(<Admin />, "page") },
                  {
                    path: "/admin/cleanup/:kind",
                    element: chunk(<CleanupReview />, "page"),
                  },
                  {
                    path: "/admin/health",
                    element: <Navigate to="/admin?section=health" replace />,
                  },
                  {
                    path: "/account",
                    element: <Navigate to="/settings" replace />,
                  },
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
