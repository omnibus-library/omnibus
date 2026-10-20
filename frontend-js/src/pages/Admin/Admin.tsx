import type { ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { PageTitle } from "../../components/PageTitle/PageTitle";
import {
  NavGroup,
  NavItem,
  SectionHeader,
  SettingsShell,
} from "../../components/SettingsShell/SettingsShell";
import { useCurrentUser } from "../../session";
import { CleanupCard } from "./CleanupCard";
import { EbookConvertCard } from "./EbookConvertCard";
import { HealthSection } from "./HealthSection";
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

const sectionOf = (search: string) =>
  parseSection(new URLSearchParams(search).get("section")).slug;

/** The cards of an admin section; each section's port fills in its arm. */
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
      return null;
    default: {
      const _exhaustive: never = slug;
      return _exhaustive;
    }
  }
}

/** Library and Server groups, plus the way back to personal settings. */
function AdminNav({ active }: { active: AdminSection }) {
  return (
    <>
      {(["Library", "Server"] as const).map((group) => (
        <NavGroup key={group} label={group}>
          {ADMIN_SECTIONS.filter((s) => s.group === group).map((s) => (
            <NavItem
              key={s.slug}
              to={`/admin?section=${s.slug}`}
              label={s.label}
              testId={`admin-nav-${s.slug}`}
              active={s.slug === active.slug}
            />
          ))}
        </NavGroup>
      ))}
      <NavGroup divided>
        <NavItem
          to="/settings"
          label="Your settings"
          testId="admin-nav-settings"
          active={false}
        />
      </NavGroup>
    </>
  );
}

/** Server administration: the settings shell over the sections an admin owns. */
export function Admin() {
  const { isAdmin } = useCurrentUser();
  const [search] = useSearchParams();
  const raw = search.get("section");
  const active = parseSection(raw);
  return (
    <>
      <PageTitle page={adminTitle(raw)} />
      <SettingsShell
        title="Administration"
        testId="admin-layout"
        navLabel="Administration sections"
        backTo={isAdmin ? "/admin" : null}
        hasSection={raw !== null || !isAdmin}
        openSection={sectionOf}
        nav={isAdmin ? <AdminNav active={active} /> : null}
      >
        {isAdmin ? (
          <>
            <SectionHeader title={active.label} />
            {sectionContent(active.slug)}
          </>
        ) : (
          <div className="admin-forbidden" data-testid="admin-forbidden">
            <h1>Administration</h1>
            <p>Administration is only open to server administrators.</p>
            <Link to="/settings">Go to your settings</Link>
          </div>
        )}
      </SettingsShell>
    </>
  );
}
