import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";

export const THEMES = ["dark", "black", "light", "sepia"] as const;
export type Theme = (typeof THEMES)[number];

/** Whether a stored or chosen value names one of the four Atrium themes. */
export function isTheme(value: unknown): value is Theme {
  return THEMES.some((theme) => theme === value);
}

/** Where the theme is saved: the Dioxus client's key, so both share one per origin. */
export const THEME_STORAGE_KEY = "omn.theme";

function savedTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(stored) ? stored : "dark";
  } catch {
    return "dark";
  }
}

function saveTheme(theme: Theme) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage blocked: the pick holds for this visit only.
  }
}

type ThemeState = { theme: Theme; setTheme: (theme: Theme) => void };

const ThemeContext = createContext<ThemeState | null>(null);

/** The current theme and the setter that switches it; only under `AtriumRoot`. */
export function useTheme(): ThemeState {
  const state = useContext(ThemeContext);
  if (!state) throw new Error("useTheme rendered outside AtriumRoot");
  return state;
}

/** The `.atrium` wrapper every theme token in tokens.css resolves against. */
export function AtriumRoot({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState(savedTheme);
  const [snap, setSnap] = useState(false);
  const setTheme = (next: Theme) => {
    setSnap(true);
    setThemeState(next);
    saveTheme(next);
  };
  // Two frames so a style pass runs with transitions off; the timeout covers
  // a hidden tab, where requestAnimationFrame never fires.
  useEffect(() => {
    if (!snap) return;
    let live = true;
    const settle = () => live && setSnap(false);
    requestAnimationFrame(() => requestAnimationFrame(settle));
    const timer = setTimeout(settle, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [snap]);
  return (
    <ThemeContext value={{ theme, setTheme }}>
      <div className={snap ? "atrium theme-snap" : "atrium"} data-theme={theme}>
        {children}
      </div>
    </ThemeContext>
  );
}
