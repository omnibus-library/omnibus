import type { ReactNode } from "react";
import { classes } from "../../classes";
import { type Theme, useTheme } from "../../components/Theme/AtriumRoot";
import { Scrim } from "./DrawerShell";
import {
  clampFontSize,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  type PrefName,
  type ReaderPrefs,
  TYPEFACE_CSS,
} from "./typography";

type Option<T extends string> = readonly [token: T, label: string];

const THEMES = [
  ["dark", "Dark"],
  ["black", "Black"],
  ["light", "Light"],
  ["sepia", "Sepia"],
] as const satisfies readonly Option<Theme>[];

const TYPEFACES = [
  ["original", "Original"],
  ["editorial", "Editorial"],
  ["classic", "Classic"],
  ["modern", "Modern"],
  ["sans", "Sans"],
  ["mono", "Mono"],
] as const satisfies readonly Option<ReaderPrefs["typeface"]>[];

const LINE_SPACINGS = [
  ["tight", "Tight"],
  ["cozy", "Cozy"],
  ["airy", "Airy"],
] as const satisfies readonly Option<ReaderPrefs["lineSpacing"]>[];

const MARGINS = [
  ["narrow", "Narrow"],
  ["normal", "Normal"],
  ["wide", "Wide"],
] as const satisfies readonly Option<ReaderPrefs["margins"]>[];

const SPREADS = [
  ["single", "Single"],
  ["double", "Two-page"],
] as const satisfies readonly Option<ReaderPrefs["spread"]>[];

function Row({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={classes("rd-aa-row", className)}>
      <div className="rd-aa-label">{label}</div>
      {children}
    </div>
  );
}

type SegmentsProps<T extends string> = {
  label: string;
  options: readonly Option<T>[];
  value: T;
  onSelect: (token: T) => void;
  testId?: (token: T) => string;
};

function Segments<T extends string>({
  label,
  options,
  value,
  onSelect,
  testId,
}: SegmentsProps<T>) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a fieldset brings a border and min-width Atrium never resets
    <div className="rd-seg" role="group" aria-label={label}>
      {options.map(([token, text]) => (
        <button
          key={token}
          type="button"
          className={value === token ? "on" : undefined}
          aria-pressed={value === token}
          data-testid={testId?.(token)}
          onClick={() => onSelect(token)}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

type AaPanelProps = {
  prefs: ReaderPrefs;
  onChange: <K extends PrefName>(name: K, value: ReaderPrefs[K]) => void;
  onClose: () => void;
};

/** The typography panel: theme, typeface, text size, line spacing, margins, page view and justify. */
export function AaPanel({ prefs, onChange, onClose }: AaPanelProps) {
  const { theme, setTheme } = useTheme();
  const sizePct =
    ((prefs.fontSize - FONT_SIZE_MIN) / (FONT_SIZE_MAX - FONT_SIZE_MIN)) * 100;
  return (
    <>
      <Scrim onClick={onClose} />
      <div className="rd-aa-panel" data-testid="reader-aa-panel">
        <div className="rd-grabber" />
        <Row label="Theme">
          <Segments
            label="Theme"
            options={THEMES}
            value={theme}
            onSelect={setTheme}
          />
        </Row>
        <Row label="Typeface">
          <div className="rd-typeface-row">
            {TYPEFACES.map(([token, name]) => {
              const stack = TYPEFACE_CSS[token];
              return (
                <button
                  key={token}
                  type="button"
                  className={classes(
                    "rd-typeface-chip",
                    prefs.typeface === token && "on",
                  )}
                  aria-pressed={prefs.typeface === token}
                  data-testid={`reader-typeface-${token}`}
                  onClick={() => onChange("typeface", token)}
                >
                  {/* Original has no face to preview, so its specimen inherits the panel's own. */}
                  <span
                    className="preview"
                    style={stack === null ? undefined : { fontFamily: stack }}
                  >
                    Aa
                  </span>
                  <span className="name">{name}</span>
                </button>
              );
            })}
          </div>
        </Row>
        <Row label="Text size">
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button
              type="button"
              className="rd-tool"
              aria-label="Decrease font size"
              data-testid="reader-font-decrease"
              style={{
                fontFamily: "var(--serif)",
                fontSize: 13,
                color: "var(--ink-2)",
                minWidth: 24,
                height: 24,
                padding: 0,
              }}
              onClick={() =>
                onChange("fontSize", clampFontSize(prefs.fontSize - 1))
              }
            >
              A
            </button>
            <div className="rd-size-track">
              <div className="rd-size-fill" style={{ width: `${sizePct}%` }} />
              <div className="rd-size-thumb" style={{ left: `${sizePct}%` }} />
            </div>
            <button
              type="button"
              className="rd-tool"
              aria-label="Increase font size"
              data-testid="reader-font-increase"
              style={{
                fontFamily: "var(--serif)",
                fontSize: 24,
                color: "var(--ink-1)",
                minWidth: 24,
                height: 24,
                padding: 0,
              }}
              onClick={() =>
                onChange("fontSize", clampFontSize(prefs.fontSize + 1))
              }
            >
              A
            </button>
          </div>
        </Row>
        <Row label="Line spacing">
          <Segments
            label="Line spacing"
            options={LINE_SPACINGS}
            value={prefs.lineSpacing}
            onSelect={(token) => onChange("lineSpacing", token)}
          />
        </Row>
        <Row label="Margins">
          <Segments
            label="Margins"
            options={MARGINS}
            value={prefs.margins}
            onSelect={(token) => onChange("margins", token)}
          />
        </Row>
        {/* The phone breakpoint hides this row: a phone column never renders a two-page spread. */}
        <Row label="Page view" className="rd-aa-row-spread">
          <Segments
            label="Page view"
            options={SPREADS}
            value={prefs.spread}
            onSelect={(token) => onChange("spread", token)}
            testId={(token) => `reader-spread-${token}`}
          />
        </Row>
        <div className="rd-toggle-row">
          <span style={{ fontSize: 13, color: "var(--ink-1)" }}>
            Justify text
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={prefs.justify}
            aria-label="Justify text"
            className={classes("rd-toggle-track", prefs.justify && "on")}
            // Atrium sizes the track; a button also needs its default border and padding gone.
            style={{ border: 0, padding: 0 }}
            onClick={() => onChange("justify", !prefs.justify)}
          >
            <span className="rd-toggle-knob" />
          </button>
        </div>
      </div>
    </>
  );
}
