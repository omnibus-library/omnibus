import { type ReactNode, useState } from "react";

const THEMES = ["dark", "black", "light", "sepia"] as const;
type Theme = (typeof THEMES)[number];

function isTheme(value: unknown): value is Theme {
  return THEMES.some((theme) => theme === value);
}

// Same key the Dioxus client persists, so the two share a theme on one origin.
function savedTheme(): Theme {
  try {
    const stored = localStorage.getItem("omn.theme");
    return isTheme(stored) ? stored : "dark";
  } catch {
    return "dark";
  }
}

/** The `.atrium` wrapper every theme token in tokens.css resolves against. */
export function AtriumRoot({ children }: { children: ReactNode }) {
  const [theme] = useState(savedTheme);
  return (
    <div className="atrium" data-theme={theme}>
      {children}
    </div>
  );
}
