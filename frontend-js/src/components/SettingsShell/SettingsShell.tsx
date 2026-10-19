import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { Link } from "react-router";
import { UnsavedDialog, useLeaveGuard } from "../Unsaved/Unsaved";
import "../../styles/settings.css";

type ReportDirty = (id: string, dirty: boolean) => void;

const UnsavedForms = createContext<ReportDirty | null>(null);

/** Reports whether form `id` holds edits to the enclosing SettingsShell; a no-op outside one. */
export function useUnsavedForm(id: string, dirty: boolean) {
  const report = useContext(UnsavedForms);
  useEffect(() => {
    report?.(id, dirty);
    return () => report?.(id, false);
  }, [report, id, dirty]);
}

type SettingsShellProps = {
  /** The sidebar's heading. */
  title: string;
  testId: string;
  navLabel: string;
  /** The narrow screens' "‹ {title}" link; null draws none. */
  backTo: string | null;
  /** A section is open (or the page refuses): narrow screens show the content, not the list. */
  hasSection: boolean;
  /** The canonical section a `location.search` opens; moving between two that differ asks first. */
  openSection: (search: string) => string;
  /** The sidebar's links; null draws no sidebar. */
  nav: ReactNode;
  children: ReactNode;
};

/** The two-pane frame `/settings` and `/admin` share: section links beside the open section. */
export function SettingsShell({
  title,
  testId,
  navLabel,
  backTo,
  hasSection,
  openSection,
  nav,
  children,
}: SettingsShellProps) {
  const [dirtyForms, setDirtyForms] = useState<ReadonlySet<string>>(new Set());
  const report = useCallback<ReportDirty>((id, dirty) => {
    setDirtyForms((forms) => {
      if (forms.has(id) === dirty) return forms;
      const next = new Set(forms);
      if (dirty) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);
  const { blocker } = useLeaveGuard(
    dirtyForms.size > 0,
    (from, to) =>
      from.pathname !== to.pathname ||
      openSection(from.search) !== openSection(to.search),
  );
  return (
    <UnsavedForms.Provider value={report}>
      <div
        className={
          hasSection ? "settings-layout has-section" : "settings-layout"
        }
        data-testid={testId}
      >
        {nav !== null && (
          <nav className="settings-sidebar" aria-label={navLabel}>
            <div className="settings-sidebar-head">
              <h1>{title}</h1>
            </div>
            {nav}
          </nav>
        )}
        <div className="settings-content">
          {backTo !== null && (
            <Link
              to={backTo}
              className="settings-back"
              data-testid="settings-back"
            >
              <span aria-hidden="true">{"‹ "}</span>
              {title}
            </Link>
          )}
          {children}
        </div>
      </div>
      <UnsavedDialog
        blocker={blocker}
        body="You've edited a setting in this section without saving it."
      />
    </UnsavedForms.Provider>
  );
}

/** A labelled run of sidebar links; `divided` rules it off from the groups above. */
export function NavGroup({
  label,
  divided = false,
  children,
}: {
  label?: string;
  divided?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={divided ? "settings-nav-group divided" : "settings-nav-group"}
    >
      {label && <div className="settings-nav-group-label">{label}</div>}
      {children}
    </div>
  );
}

/** One sidebar link, marked `aria-current="page"` when it is the open section. */
export function NavItem({
  to,
  label,
  testId,
  active,
}: {
  to: string;
  label: string;
  testId: string;
  active: boolean;
}) {
  return (
    <Link
      to={to}
      className={active ? "settings-nav-item active" : "settings-nav-item"}
      data-testid={testId}
      aria-current={active ? "page" : "false"}
    >
      {label}
    </Link>
  );
}

/** The open section's heading. */
export function SectionHeader({ title }: { title: string }) {
  return (
    <header className="settings-section-head">
      <h2>{title}</h2>
    </header>
  );
}
