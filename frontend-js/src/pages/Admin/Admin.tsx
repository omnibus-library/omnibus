import type { ComponentType } from "react";
import { Link, useSearchParams } from "react-router";
import { PageTitle } from "../../components/PageTitle/PageTitle";
import {
  type NavGroup,
  SectionHeader,
  SettingsShell,
} from "../../components/SettingsShell/SettingsShell";
import { useCurrentUser } from "../../session";
import {
  ADMIN_SECTIONS,
  type AdminSection,
  type AdminSlug,
  parseAdminSection,
  sameSection,
  sectionHref,
} from "../../settingsIndex";
import { CleanupCard } from "./CleanupCard";
import { EbookConvertCard } from "./EbookConvertCard";
import { HealthSection } from "./HealthSection";
import { LogsSection } from "./LogsSection";
import { MaintenanceCard } from "./MaintenanceCard";
import { McpCard } from "./McpCard";
import { MetadataOrderCard } from "./MetadataOrderCard";
import { RecentTasksCard } from "./RecentTasksCard";
import { RegistrationCard } from "./RegistrationCard";
import { SecretKeyCard } from "./SecretKeyCard";
import { SmtpCard } from "./SmtpCard";
import { SourcesCard } from "./SourcesCard";
import { UsersCard } from "./UsersCard";
import "./Admin.css";

function Maintenance() {
  return (
    <>
      <MaintenanceCard />
      <RecentTasksCard />
    </>
  );
}

function People() {
  return (
    <>
      <RegistrationCard />
      <UsersCard />
    </>
  );
}

function Integrations() {
  return (
    <>
      <SmtpCard />
      <SecretKeyCard kind="hardcover" />
      <SecretKeyCard kind="google-books" />
      <EbookConvertCard />
      <McpCard />
    </>
  );
}

// A Record, so a section added to the slugs cannot be left without a body.
const BODIES: Record<AdminSlug, ComponentType> = {
  sources: SourcesCard,
  maintenance: Maintenance,
  metadata: MetadataOrderCard,
  cleanup: CleanupCard,
  people: People,
  integrations: Integrations,
  health: HealthSection,
  logs: LogsSection,
};

/** Library and Server groups, plus the way back to personal settings. */
function adminNav(active: AdminSection): NavGroup[] {
  return [
    ...(["Library", "Server"] as const).map((group) => ({
      label: group,
      items: ADMIN_SECTIONS.filter((s) => s.group === group).map((s) => ({
        to: sectionHref(s),
        label: s.label,
        testId: `admin-nav-${s.slug}`,
        active: s.slug === active.slug,
      })),
    })),
    {
      divided: true,
      items: [
        {
          to: "/settings",
          label: "Your settings",
          testId: "admin-nav-settings",
          active: false,
        },
      ],
    },
  ];
}

/** Server administration: the settings shell over the sections an admin owns. */
export function Admin() {
  const { isAdmin } = useCurrentUser();
  const [search] = useSearchParams();
  const raw = search.get("section");
  const active = parseAdminSection(raw);
  const title = `${active.label} · Administration`;
  if (!isAdmin) {
    return (
      <>
        <PageTitle page={title} />
        <div className="admin-forbidden" data-testid="admin-forbidden">
          <h1>Administration</h1>
          <p>Administration is only open to server administrators.</p>
          <Link to="/settings">Go to your settings</Link>
        </div>
      </>
    );
  }
  const Body = BODIES[active.slug];
  return (
    <>
      <PageTitle page={title} />
      <SettingsShell
        title="Administration"
        testId="admin-layout"
        navLabel="Administration sections"
        nav={adminNav(active)}
        hasSection={raw !== null}
        backTo="/admin"
        samePlace={sameSection}
      >
        <SectionHeader title={active.label} />
        <Body />
      </SettingsShell>
    </>
  );
}
