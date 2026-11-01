import "./styles/theme.css";
import "./styles/base.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router";
import { AtriumRoot } from "./components/Theme/AtriumRoot";
import { watchImageLoads } from "./imageWatch";
import { router } from "./router";
import { reloadOnStaleChunk } from "./staleChunk";

watchImageLoads();
reloadOnStaleChunk(window, sessionStorage, () => window.location.reload());

// No retries: a failed fetch shows its error at once.
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

const root = document.getElementById("root");
if (!root) throw new Error("index.html has no #root element");

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AtriumRoot>
        <RouterProvider router={router} />
      </AtriumRoot>
    </QueryClientProvider>
  </StrictMode>,
);
