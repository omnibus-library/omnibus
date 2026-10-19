/** The `/admin` sections in sidebar order, Library's four then Server's four. */
export const ADMIN_SECTIONS = [
  { slug: "sources", label: "Sources", group: "Library" },
  { slug: "maintenance", label: "Maintenance", group: "Library" },
  { slug: "metadata", label: "Metadata", group: "Library" },
  { slug: "cleanup", label: "Cleanup", group: "Library" },
  { slug: "people", label: "People", group: "Server" },
  { slug: "integrations", label: "Integrations", group: "Server" },
  { slug: "health", label: "Health", group: "Server" },
  { slug: "logs", label: "Logs", group: "Server" },
] as const;

export type AdminSection = (typeof ADMIN_SECTIONS)[number];

/** Resolves a `?section=` slug; anything unrecognised opens Sources. */
export function parseSection(raw: string | null): AdminSection {
  return ADMIN_SECTIONS.find((s) => s.slug === raw) ?? ADMIN_SECTIONS[0];
}

/** The browser-tab subtitle for `/admin?section=<raw>`. */
export function adminTitle(raw: string | null): string {
  return `${parseSection(raw).label} · Administration`;
}
