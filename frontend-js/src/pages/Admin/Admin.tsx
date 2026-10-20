import type { ReactNode } from "react";
import { Link, type Location, useSearchParams } from "react-router";
import { PageTitle } from "../../components/PageTitle/PageTitle";
import {
  type NavGroup,
  SectionHeader,
  SettingsShell,
} from "../../components/SettingsShell/SettingsShell";
import { useCurrentUser } from "../../session";
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
import {
  ADMIN_SECTIONS,
  type AdminSection,
  adminTitle,
  parseSection,
} from "./sections";
import { UsersCard } from "./UsersCard";
import "./Admin.css";

const sectionOf = (location: Location) =>
  parseSection(new URLSearchParams(location.search).get("section")).slug;

/** Moving between two places that open the same section drops no edits. */
const sameSection = (a: Location, b: Location) =>
  a.pathname === b.pathname && sectionOf(a) === sectionOf(b);

function sectionContent(slug: AdminSection["slug"]): ReactNode {
  switch (slug) {
    case "sources":
      return <SourcesCard />;
    case "maintenance":
      return (
        <>
          <MaintenanceCard />
          <RecentTasksCard />
        </>
      );
    case "metadata":
      return <MetadataOrderCard />;
    case "cleanup":
      return <CleanupCard />;
    case "people":
      return (
        <>
          <RegistrationCard />
          <UsersCard />
        </>
      );
    case "integrations":
      return (
        <>
          <SmtpCard />
          <SecretKeyCard kind="hardcover" />
          <SecretKeyCard kind="google-books" />
          <EbookConvertCard />
          <McpCard />
        </>
      );
    case "health":
      return <HealthSection />;
    case "logs":
      return <LogsSection />;
    default: {
      const _exhaustive: never = slug;
      return _exhaustive;
    }
  }
}

/** Library and Server groups, plus the way back to personal settings. */
function adminNav(active: AdminSection): NavGroup[] {
  return [
    ...(["Library", "Server"] as const).map((group) => ({
      label: group,
      items: ADMIN_SECTIONS.filter((s) => s.group === group).map((s) => ({
        to: `/admin?section=${s.slug}`,
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
  const active = parseSection(raw);
  if (!isAdmin) {
    return (
      <>
        <PageTitle page={adminTitle(raw)} />
        <div className="admin-forbidden" data-testid="admin-forbidden">
          <h1>Administration</h1>
          <p>Administration is only open to server administrators.</p>
          <Link to="/settings">Go to your settings</Link>
        </div>
      </>
    );
  }
  return (
    <>
      <PageTitle page={adminTitle(raw)} />
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
        {sectionContent(active.slug)}
      </SettingsShell>
    </>
  );
}
