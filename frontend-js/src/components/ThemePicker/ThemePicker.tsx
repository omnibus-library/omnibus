import { THEMES, type Theme, useTheme } from "../Theme/AtriumRoot";
import "./ThemePicker.css";

const LABELS: Record<Theme, string> = {
  dark: "Dark",
  black: "Black",
  light: "Light",
  sepia: "Sepia",
};

/** The four Atrium themes as one segmented group, the current one pressed. */
export function ThemePicker() {
  const { theme, setTheme } = useTheme();
  return (
    // biome-ignore lint/a11y/useSemanticElements: a fieldset brings default border and min-width that Atrium's .theme-seg never resets
    <div className="theme-seg" role="group" aria-label="Theme">
      {THEMES.map((t) => (
        <button
          key={t}
          type="button"
          className={t === theme ? "theme-seg-btn on" : "theme-seg-btn"}
          data-testid={`theme-${t}`}
          aria-pressed={t === theme}
          onClick={() => setTheme(t)}
        >
          {LABELS[t]}
        </button>
      ))}
    </div>
  );
}
