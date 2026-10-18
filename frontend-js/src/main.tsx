import "../../frontend/assets/atrium.css";
import "../../frontend/assets/loading.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { AtriumRoot } from "./atrium";
import { BookDetail } from "./pages/BookDetail";
import { Library } from "./pages/Library";
import { Login } from "./pages/Login";
import { RequireAuth } from "./session";

// loading.css stops a cover's glint on img[data-loaded]; the Dioxus BootScript
// stamps it the same way, from a capture-phase listener.
document.addEventListener(
  "load",
  (event) => {
    if (event.target instanceof HTMLImageElement) {
      event.target.setAttribute("data-loaded", "");
    }
  },
  true,
);

const router = createBrowserRouter([
  { path: "/login", element: <Login /> },
  {
    element: <RequireAuth />,
    children: [
      { path: "/", element: <Library /> },
      { path: "/books/:uuid", element: <BookDetail /> },
    ],
  },
]);

const root = document.getElementById("root");
if (!root) throw new Error("index.html has no #root element");

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={new QueryClient()}>
      <AtriumRoot>
        <RouterProvider router={router} />
      </AtriumRoot>
    </QueryClientProvider>
  </StrictMode>,
);
