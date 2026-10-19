import { type Location, Navigate, useSearchParams } from "react-router";
import { PageTitle } from "../../components/PageTitle/PageTitle";
import {
  type NavGroup,
  SectionHeader,
  SettingsShell,
} from "../../components/SettingsShell/SettingsShell";
import { useCurrentUser } from "../../session";
import {
  legacySettingsHref,
  PERSONAL_SECTIONS,
  parseSettingsSection,
  sectionHref,
} from "../../settingsIndex";
import { PreferencesSection } from "./PreferencesSection";
import { ProfileSection } from "./ProfileSection";

const sectionOf = (location: Location) =>
  parseSettingsSection(new URLSearchParams(location.search).get("section"));

/** Moving between two places that open the same section drops no edits. */
export const sameSection = (a: Location, b: Location) =>
  a.pathname === b.pathname && sectionOf(a).slug === sectionOf(b).slug;

/** Personal settings: five sections picked by `?section=`, and a way into Administration for admins. */
export function Settings() {
  const [search] = useSearchParams();
  const raw = search.get("section");
  const { isAdmin } = useCurrentUser();
  const legacy = raw ? legacySettingsHref(raw) : null;
  if (legacy) return <Navigate to={legacy} replace />;

  const active = parseSettingsSection(raw);
  const nav: NavGroup[] = [
    {
      items: PERSONAL_SECTIONS.map((section) => ({
        to: sectionHref(section),
        label: section.label,
        testId: `settings-nav-${section.slug}`,
        active: section.slug === active.slug,
      })),
    },
  ];
  if (isAdmin) {
    nav.push({
      divided: true,
      items: [
        {
          to: "/admin",
          label: "Administration",
          testId: "settings-nav-admin",
          active: false,
        },
      ],
    });
  }
  return (
    <SettingsShell
      title="Settings"
      testId="settings-layout"
      navLabel="Settings sections"
      nav={nav}
      hasSection={raw !== null}
      backTo="/settings"
      samePlace={sameSection}
    >
      <PageTitle page={`${active.label} · Settings`} />
      <SectionHeader title={active.label} />
      {active.slug === "profile" && <ProfileSection />}
      {active.slug === "preferences" && <PreferencesSection />}
    </SettingsShell>
  );
}
