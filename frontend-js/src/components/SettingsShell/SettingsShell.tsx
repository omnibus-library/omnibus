import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { Link, type Location } from "react-router";
import { classes } from "../../classes";
import { UnsavedDialog, useLeaveGuard } from "../Unsaved/Unsaved";
import "../../styles/settings.css";

export type NavItem = {
  to: string;
  label: string;
  testId: string;
  active: boolean;
};

/** A labelled run of sidebar links; `divided` rules it off from the groups above. */
export type NavGroup = {
  label?: string;
  divided?: boolean;
  items: NavItem[];
};

// Each form in the open section reports its dirtiness here by id.
const DirtyContext = createContext<
  ((id: string, dirty: boolean) => void) | null
>(null);

/** Registers a form's edits with the surrounding shell, which asks before they are lost; a no-op outside one. */
export function useUnsavedGuard(id: string, dirty: boolean) {
  const report = useContext(DirtyContext);
  useEffect(() => {
    report?.(id, dirty);
    return () => report?.(id, false);
  }, [report, id, dirty]);
}

type SettingsShellProps = {
  title: string;
  testId: string;
  navLabel: string;
  nav: NavGroup[];
  /** Set when `?section=` is present: under 720px the layout then shows the section, not the list. */
  hasSection: boolean;
  /** The section-less route a narrow screen's "‹ title" link returns to. */
  backTo: string | null;
  /** What the leave guard treats as staying put, such as the same section. */
  samePlace: (a: Location, b: Location) => boolean;
  children: ReactNode;
};

/** The two-pane frame `/settings` and `/admin` share: a sidebar of section links beside the open section. */
export function SettingsShell({
  title,
  testId,
  navLabel,
  nav,
  hasSection,
  backTo,
  samePlace,
  children,
}: SettingsShellProps) {
  const [dirty, setDirty] = useState<ReadonlySet<string>>(new Set());
  const report = useCallback((id: string, isDirty: boolean) => {
    setDirty((prev) => {
      if (prev.has(id) === isDirty) return prev;
      const next = new Set(prev);
      if (isDirty) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);
  const { blocker } = useLeaveGuard(dirty.size > 0, samePlace);
  return (
    <DirtyContext.Provider value={report}>
      <UnsavedDialog
        blocker={blocker}
        body="You've edited a setting in this section without saving it."
      />
      <div
        className={classes("settings-layout", hasSection && "has-section")}
        data-testid={testId}
      >
        <nav className="settings-sidebar" aria-label={navLabel}>
          <div className="settings-sidebar-head">
            <h1>{title}</h1>
          </div>
          {nav.map((group) => (
            <div
              key={group.label ?? group.items.map((i) => i.testId).join()}
              className={classes(
                "settings-nav-group",
                group.divided && "divided",
              )}
            >
              {group.label && (
                <div className="settings-nav-group-label">{group.label}</div>
              )}
              {group.items.map((item) => (
                <Link
                  key={item.testId}
                  to={item.to}
                  className={classes(
                    "settings-nav-item",
                    item.active && "active",
                  )}
                  data-testid={item.testId}
                  aria-current={item.active ? "page" : "false"}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className="settings-content">
          {backTo && (
            <Link
              to={backTo}
              className="settings-back"
              data-testid="settings-back"
            >
              <span aria-hidden="true">‹ </span>
              {title}
            </Link>
          )}
          {children}
        </div>
      </div>
    </DirtyContext.Provider>
  );
}

/** The open section's heading; each card below says what it holds. */
export function SectionHeader({ title }: { title: string }) {
  return (
    <header className="settings-section-head">
      <h2>{title}</h2>
    </header>
  );
}

/** A card's last result: what it says and whether it was a refusal. */
export type Status = { message: string; error: boolean };

type StatusLineProps = {
  testId: string;
  status: Status | null;
  /** Sits in a card's footer row beside the actions. */
  action?: boolean;
  /** The message is a wait, drawn as a sheen rather than a result. */
  pending?: boolean;
};

/** A card's save result: a live region mounted empty, so its first message is announced. */
export function StatusLine({
  testId,
  status,
  action = false,
  pending = false,
}: StatusLineProps) {
  const message = status?.message;
  return (
    <p
      role="status"
      className={classes(
        "settings-status",
        action && "settings-action-status",
        message && !pending && (status.error ? "error" : "success"),
      )}
      data-testid={testId}
    >
      {pending ? <span className="ld-sheen">{message}</span> : message}
    </p>
  );
}

/** A link out of the app, opened in a new tab. */
export function External({
  href,
  children,
}: {
  href: string;
  children: string;
}) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}
