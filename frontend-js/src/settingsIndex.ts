// Mirrors SETTINGS_INDEX in frontend/src/pages/settings/sections.rs, which
// the Dioxus palette searches; keep the two in step until that one retires.

import type { Location } from "react-router";

type Area = "settings" | "admin";

export type Section = { area: Area; slug: string; label: string };

/** The `?section=` slugs of `/settings`. */
export type PersonalSlug =
  | "profile"
  | "preferences"
  | "goals"
  | "devices"
  | "security";

export type PersonalSection = Section & { slug: PersonalSlug };

const personal = (slug: PersonalSlug, label: string): PersonalSection => ({
  area: "settings",
  slug,
  label,
});
/** The `?section=` slugs of `/admin`. */
export type AdminSlug =
  | "sources"
  | "maintenance"
  | "metadata"
  | "cleanup"
  | "people"
  | "integrations"
  | "health"
  | "logs";

export type AdminSection = Section & {
  slug: AdminSlug;
  group: "Library" | "Server";
};

const admin = (
  slug: AdminSlug,
  label: string,
  group: AdminSection["group"],
): AdminSection => ({ area: "admin", slug, label, group });

const PROFILE = personal("profile", "Profile");
const PREFERENCES = personal("preferences", "Preferences");
const GOALS = personal("goals", "Goals");
const DEVICES = personal("devices", "Devices");
const SECURITY = personal("security", "Sign-in & security");
/** The five personal sections, in sidebar order. */
export const PERSONAL_SECTIONS: readonly PersonalSection[] = [
  PROFILE,
  PREFERENCES,
  GOALS,
  DEVICES,
  SECURITY,
];

const SOURCES = admin("sources", "Sources", "Library");
const MAINTENANCE = admin("maintenance", "Maintenance", "Library");
const METADATA = admin("metadata", "Metadata", "Library");
const CLEANUP = admin("cleanup", "Cleanup", "Library");
const PEOPLE = admin("people", "People", "Server");
const INTEGRATIONS = admin("integrations", "Integrations", "Server");
const HEALTH = admin("health", "Health", "Server");
const LOGS = admin("logs", "Logs", "Server");
/** The eight admin sections, in sidebar order: Library's four, then Server's. */
export const ADMIN_SECTIONS: readonly AdminSection[] = [
  SOURCES,
  MAINTENANCE,
  METADATA,
  CLEANUP,
  PEOPLE,
  INTEGRATIONS,
  HEALTH,
  LOGS,
];

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

/** Where a section opens: `/settings` or `/admin` at its slug. */
export const sectionHref = (section: Section) =>
  `/${section.area}?section=${section.slug}`;

/** Where a setting sits, as copy names it: "Settings › Goals". */
export const settingsPlace = ({ section }: SettingsEntry) =>
  `${section.area === "settings" ? "Settings" : "Administration"} › ${section.label}`;

/** The personal section a `?section=` slug names; Profile when it is missing or unknown. */
export function parseSettingsSection(raw: string | null): PersonalSection {
  return PERSONAL_SECTIONS.find((s) => s.slug === raw) ?? PROFILE;
}

/** The admin section a `?section=` slug names; Sources when it is missing or unknown. */
export function parseAdminSection(raw: string | null): AdminSection {
  return ADMIN_SECTIONS.find((s) => s.slug === raw) ?? SOURCES;
}

const sectionAt = ({
  pathname,
  search,
}: Pick<Location, "pathname" | "search">) => {
  const raw = new URLSearchParams(search).get("section");
  return pathname === "/admin"
    ? parseAdminSection(raw)
    : parseSettingsSection(raw);
};

/** Moving between two places on `/settings` or `/admin` that open the same section drops no edits. */
export const sameSection = (
  a: Pick<Location, "pathname" | "search">,
  b: Pick<Location, "pathname" | "search">,
) => a.pathname === b.pathname && sectionAt(a).slug === sectionAt(b).slug;

// Slugs from before server administration moved to /admin, as legacy_settings_target maps them.
const LEGACY_SECTIONS: Record<string, Section> = {
  account: PROFILE,
  kindle: DEVICES,
  kobo: DEVICES,
  "api-tokens": SECURITY,
  library: SOURCES,
  metadata: METADATA,
  email: INTEGRATIONS,
  cleanup: CLEANUP,
  users: PEOPLE,
  health: HEALTH,
  "background-tasks": MAINTENANCE,
  logs: LOGS,
};

/** Where an old `?section=` slug lives now, or `null` when the slug is current or unknown. */
export function legacySettingsHref(slug: string): string | null {
  const section = Object.hasOwn(LEGACY_SECTIONS, slug)
    ? LEGACY_SECTIONS[slug]
    : undefined;
  return section ? sectionHref(section) : null;
}
