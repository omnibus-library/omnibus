import type { GlobalProvider } from "@ladle/react";
import { watchImageLoads } from "../src/imageWatch";
import { AppHarness } from "../src/testing/AppHarness";
import "../src/styles/theme.css";
import "../src/styles/base.css";

watchImageLoads();

/** Every story renders inside the app's session, router and `.atrium` root. */
export const Provider: GlobalProvider = ({ children, globalState }) => (
  <AppHarness>
    <div
      className="atrium"
      data-theme={globalState.theme === "light" ? "light" : "dark"}
      style={{ minHeight: "100vh", padding: 24 }}
    >
      {children}
    </div>
  </AppHarness>
);
