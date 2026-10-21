import type { ComponentType } from "react";
import { Navigate, useSearchParams } from "react-router";
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
  type PersonalSlug,
  parseSettingsSection,
  sameSection,
  sectionHref,
} from "../../settingsIndex";
import { ApiTokensCard } from "./ApiTokensCard";
import { GoalsSection } from "./GoalsSection";
import { KindleCard } from "./KindleCard";
import { KoboCard } from "./KoboCard";
import { PasswordCard } from "./PasswordCard";
import { PreferencesSection } from "./PreferencesSection";
import { ProfileSection } from "./ProfileSection";
import { SessionsCard } from "./SessionsCard";
import "./Settings.css";

function Security() {
  return (
    <>
      <PasswordCard />
      <SessionsCard />
      <ApiTokensCard />
    </>
  );
}

function Devices() {
  return (
    <>
      <KindleCard />
      <KoboCard />
    </>
  );
}

// A Record, so a section added to the slugs cannot be left without a body.
const BODIES: Record<PersonalSlug, ComponentType> = {
  profile: ProfileSection,
  preferences: PreferencesSection,
  goals: GoalsSection,
  devices: Devices,
  security: Security,
};

/** Personal settings: five sections picked by `?section=`, and a way into Administration for admins. */
export function Settings() {
  const [search] = useSearchParams();
  const raw = search.get("section");
  const { isAdmin } = useCurrentUser();
  const legacy = raw ? legacySettingsHref(raw) : null;
  if (legacy) return <Navigate to={legacy} replace />;

  const active = parseSettingsSection(raw);
  const Body = BODIES[active.slug];
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
      <Body />
    </SettingsShell>
  );
}
