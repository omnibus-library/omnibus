// Mirrors SETTINGS_INDEX in frontend/src/pages/settings/sections.rs, which
// the Dioxus palette searches; keep the two in step until that one retires.

type Area = "settings" | "admin";

type Section = { area: Area; slug: string; label: string };

const personal = (slug: string, label: string): Section => ({
  area: "settings",
  slug,
  label,
});
const admin = (slug: string, label: string): Section => ({
  area: "admin",
  slug,
  label,
});

const PROFILE = personal("profile", "Profile");
const PREFERENCES = personal("preferences", "Preferences");
const GOALS = personal("goals", "Goals");
const DEVICES = personal("devices", "Devices");
const SECURITY = personal("security", "Sign-in & security");
const SOURCES = admin("sources", "Sources");
const MAINTENANCE = admin("maintenance", "Maintenance");
const METADATA = admin("metadata", "Metadata");
const CLEANUP = admin("cleanup", "Cleanup");
const PEOPLE = admin("people", "People");
const INTEGRATIONS = admin("integrations", "Integrations");
const HEALTH = admin("health", "Health");
const LOGS = admin("logs", "Logs");

/** One searchable setting: its name, the words that find it, and its section. */
export type SettingsEntry = {
  label: string;
  keywords: readonly string[];
  section: Section;
};

const entry = (
  label: string,
  keywords: readonly string[],
  section: Section,
): SettingsEntry => ({ label, keywords, section });

const SETTINGS_INDEX: readonly SettingsEntry[] = [
  entry(
    "Display name & picture",
    ["profile", "avatar", "photo", "name"],
    PROFILE,
  ),
  entry(
    "Theme",
    ["dark mode", "light mode", "sepia", "black", "appearance"],
    PREFERENCES,
  ),
  entry("Stack series", ["series", "group volumes"], PREFERENCES),
  entry(
    "Hidden formats",
    ["hide formats", "audiobooks", "epub", "pdf", "m4b", "mp3"],
    PREFERENCES,
  ),
  entry(
    "Book page scroll stops",
    ["scroll", "book details", "layout"],
    PREFERENCES,
  ),
  entry(
    "Share stats with household",
    ["privacy", "household", "sharing"],
    PREFERENCES,
  ),
  entry(
    "Reading goals",
    ["goal", "target", "pages a day", "minutes a day", "books this year"],
    GOALS,
  ),
  entry("Send to Kindle", ["kindle", "email address"], DEVICES),
  entry("Kobo devices", ["kobo", "sync", "e-reader"], DEVICES),
  entry("Password", ["change password", "sign in"], SECURITY),
  entry("Sessions", ["signed in", "sign out", "revoke"], SECURITY),
  entry("API tokens", ["token", "bearer", "mcp"], SECURITY),
  entry(
    "Library folders",
    [
      "library path",
      "ebook folder",
      "audiobook folder",
      "rescan",
      "scan interval",
    ],
    SOURCES,
  ),
  entry("Metadata order", ["precedence", "provider", "metadata"], METADATA),
  entry("Library cleanup", ["duplicates", "merge", "authors"], CLEANUP),
  entry("Users", ["accounts", "people", "registration", "permissions"], PEOPLE),
  entry("Email delivery (SMTP)", ["smtp", "mail server"], INTEGRATIONS),
  entry("Hardcover", ["api key", "suggestions"], INTEGRATIONS),
  entry("Google Books", ["api key", "metadata lookup"], INTEGRATIONS),
  entry(
    "Calibre conversion",
    ["calibre", "ebook-convert", "convert"],
    INTEGRATIONS,
  ),
  entry("Hosted MCP endpoint", ["mcp"], INTEGRATIONS),
  entry(
    "Server health",
    ["health", "status", "errors", "worker queue", "storage"],
    HEALTH,
  ),
  entry("Background tasks", ["tasks", "history", "activity"], MAINTENANCE),
  entry(
    "Maintenance",
    [
      "scan library",
      "refetch author pictures",
      "extract chapters",
      "bake overrides",
    ],
    MAINTENANCE,
  ),
  entry("Server logs", ["logs"], LOGS),
];

// So settings never bury the books.
const MAX_SETTINGS_MATCHES = 5;

/** Settings whose label or keywords contain `query`, server ones for admins only. */
export function matchingSettings(
  query: string,
  isAdmin: boolean,
): SettingsEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return SETTINGS_INDEX.filter((e) => isAdmin || e.section.area === "settings")
    .filter(
      (e) =>
        e.label.toLowerCase().includes(q) ||
        e.keywords.some((k) => k.includes(q)),
    )
    .slice(0, MAX_SETTINGS_MATCHES);
}

/** Where a setting opens: its section of `/settings` or `/admin`. */
export const settingsHref = ({ section }: SettingsEntry) =>
  `/${section.area}?section=${section.slug}`;

/** Where a setting sits, as copy names it: "Settings › Goals". */
export const settingsPlace = ({ section }: SettingsEntry) =>
  `${section.area === "settings" ? "Settings" : "Administration"} › ${section.label}`;
