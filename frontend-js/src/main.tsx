import "./styles/theme.css";
import "./styles/base.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import { AtriumRoot } from "./components/Theme/AtriumRoot";
import { router } from "./router";

// Loading.css stops a cover's glint on img[data-loaded]; the Dioxus BootScript
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
