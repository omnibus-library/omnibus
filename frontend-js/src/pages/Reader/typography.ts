/** The reader's typography choices, kept under the Dioxus client's `omn.*` keys so both share them per origin. */

export const FONT_SIZE_MIN = 12;
export const FONT_SIZE_MAX = 32;

// Georgia sits ahead of the generic `serif` so a webfont that fails to load in the section degrades to a real book serif.
export const TYPEFACE_CSS = {
  // The publisher's own faces: no override at all.
  original: null,
  editorial: "'Instrument Serif',Georgia,serif",
  classic: "'EB Garamond',Georgia,serif",
  modern: "Georgia,serif",
  sans: "system-ui,-apple-system,'Helvetica Neue',Arial,sans-serif",
  mono: "ui-monospace,'SF Mono',Menlo,Consolas,monospace",
} as const;

export const LINE_HEIGHT_CSS = {
  tight: "1.4",
  cozy: "1.7",
  airy: "2.0",
} as const;

// The column's max-width, kept clear of the page-turn gutters.
export const MARGINS_CSS = {
  narrow: "min(95%, calc(100% - 172px))",
  normal: "min(80%, calc(100% - 172px))",
  wide: "min(65%, calc(100% - 172px))",
} as const;

// epub.js's `spread` modes: "none" forces one column, "auto" pairs pages once the stage is wide enough.
export const SPREAD_MODE = { single: "none", double: "auto" } as const;

export type ReaderPrefs = {
  fontSize: number;
  typeface: keyof typeof TYPEFACE_CSS;
  lineSpacing: keyof typeof LINE_HEIGHT_CSS;
  margins: keyof typeof MARGINS_CSS;
  justify: boolean;
  spread: keyof typeof SPREAD_MODE;
};
export type PrefName = keyof ReaderPrefs;

export const DEFAULT_PREFS: ReaderPrefs = {
  fontSize: 18,
  typeface: "original",
  lineSpacing: "cozy",
  margins: "normal",
  justify: false,
  spread: "double",
};

const STORAGE_KEY = {
  fontSize: "omn.fontSize",
  typeface: "omn.typeface",
  lineSpacing: "omn.lineSpacing",
  margins: "omn.margins",
  justify: "omn.justify",
  spread: "omn.spread",
} satisfies Record<PrefName, string>;

export const clampFontSize = (size: number) =>
  Math.min(Math.max(size, FONT_SIZE_MIN), FONT_SIZE_MAX);

const isKey = <T extends object>(
  table: T,
  raw: string | null,
): raw is keyof T & string => raw !== null && Object.hasOwn(table, raw);

function stored(name: PrefName): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY[name]);
  } catch {
    return null;
  }
}

/** The saved choices, each falling back to its default when absent, unrecognised or unreadable. */
export function loadReaderPrefs(): ReaderPrefs {
  const size = stored("fontSize");
  const typeface = stored("typeface");
  const lineSpacing = stored("lineSpacing");
  const margins = stored("margins");
  const justify = stored("justify");
  const spread = stored("spread");
  return {
    fontSize:
      size !== null && /^-?\d+$/.test(size)
        ? clampFontSize(Number(size))
        : DEFAULT_PREFS.fontSize,
    typeface: isKey(TYPEFACE_CSS, typeface) ? typeface : DEFAULT_PREFS.typeface,
    lineSpacing: isKey(LINE_HEIGHT_CSS, lineSpacing)
      ? lineSpacing
      : DEFAULT_PREFS.lineSpacing,
    margins: isKey(MARGINS_CSS, margins) ? margins : DEFAULT_PREFS.margins,
    justify: justify === null ? DEFAULT_PREFS.justify : justify === "true",
    spread: isKey(SPREAD_MODE, spread) ? spread : DEFAULT_PREFS.spread,
  };
}

/** Saves one choice of `prefs`; a blocked storage costs the choice its reload. */
export function saveReaderPref(name: PrefName, prefs: ReaderPrefs) {
  try {
    localStorage.setItem(STORAGE_KEY[name], String(prefs[name]));
  } catch {
    // Storage blocked: the choice holds for this visit only.
  }
}

/** The glue's `init` options for these choices. */
export const initOptions = (prefs: ReaderPrefs) => ({
  fontSize: prefs.fontSize,
  fontFamily: TYPEFACE_CSS[prefs.typeface],
  lineHeight: LINE_HEIGHT_CSS[prefs.lineSpacing],
  maxWidth: MARGINS_CSS[prefs.margins],
  justify: prefs.justify,
  spread: SPREAD_MODE[prefs.spread],
});

/** Hands one choice of `prefs` to the glue. */
export function pushReaderPref(
  glue: NonNullable<Window["OmnibusReader"]>,
  name: PrefName,
  prefs: ReaderPrefs,
) {
  switch (name) {
    case "fontSize":
      return glue.setFontSize(prefs.fontSize);
    case "typeface":
      return glue.setFont(TYPEFACE_CSS[prefs.typeface]);
    case "lineSpacing":
      return glue.setLineHeight(LINE_HEIGHT_CSS[prefs.lineSpacing]);
    case "margins":
      return glue.setMargins(MARGINS_CSS[prefs.margins]);
    case "justify":
      return glue.setJustify(prefs.justify);
    case "spread":
      return glue.setSpread(SPREAD_MODE[prefs.spread]);
    default: {
      const _exhaustive: never = name;
      return _exhaustive;
    }
  }
}
