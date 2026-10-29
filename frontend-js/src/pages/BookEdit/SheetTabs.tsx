import { useQuery } from "@tanstack/react-query";
import { type KeyboardEvent, type ReactNode, useState } from "react";
import { flushSync } from "react-dom";
import { hasProviderQuery, type Inspected } from "../../api";
import { Button } from "../../components/Button/Button";
import { SparkleGlyph } from "../../components/Glyphs/Glyphs";
import { prefersReducedMotion } from "../../motion";

// The parts the edit sheet and the add-book sheet share: the tabs, their panels and Fetch metadata.

export type TabKey = "details" | "artwork" | "identifiers";

const TABS: { key: TabKey; label: string }[] = [
  { key: "details", label: "Details" },
  { key: "artwork", label: "Artwork" },
  { key: "identifiers", label: "Identifiers" },
];

/** The Fetch metadata button's id: where focus goes back to when its view is left. */
const FETCH_ID = "es-fetch-open";

const tabId = (key: TabKey) => `es-tab-${key}`;
const panelId = (key: TabKey) => `es-panel-${key}`;

/** Which tab shows, whether Fetch metadata has taken the tabs' place, and the ways back from it. */
export function useSheetView() {
  const [tab, setTab] = useState<TabKey>("details");
  const [fetching, setFetching] = useState(false);
  // The fetch view hands back: to Details with the edited fields in view, or to Artwork for a cover alone.
  const applied = (to: TabKey, field: string | null) => {
    flushSync(() => {
      setFetching(false);
      setTab(to);
    });
    // The first field it changed holds focus, or Details when that one is a chip list.
    const target =
      document.getElementById(field ?? "") ??
      document.getElementById(tabId(to));
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({
      block: "nearest",
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
  };
  const leaveFetch = () => {
    flushSync(() => setFetching(false));
    document.getElementById(FETCH_ID)?.focus();
  };
  // A refused value is on Details; react-hook-form focuses its input once the panel is showing.
  const showDetails = () => flushSync(() => setTab("details"));
  return {
    tab,
    setTab,
    fetching,
    setFetching,
    applied,
    leaveFetch,
    showDetails,
  };
}

/** The Fetch metadata button, shown only once a provider is set up to answer. */
export function FetchToggle({
  fetching,
  disabled,
  onToggle,
}: {
  fetching: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const providers = useQuery(hasProviderQuery);
  if (!providers.data) return null;
  return (
    <Button
      id={FETCH_ID}
      className="es-fetch-open"
      data-testid="es-fetch"
      aria-expanded={fetching}
      disabled={disabled}
      onClick={onToggle}
    >
      <SparkleGlyph />
      Fetch metadata
    </Button>
  );
}

/** Details, Artwork and Identifiers: arrow keys move between them, and a dot marks a tab holding edits. */
export function SheetTabs({
  tab,
  edited,
  hidden,
  onSelect,
}: {
  tab: TabKey;
  edited: Record<TabKey, boolean>;
  /** The fetch view has taken the tabs' place. */
  hidden: boolean;
  onSelect: (tab: TabKey) => void;
}) {
  const onKeyDown = (event: KeyboardEvent) => {
    const at = TABS.findIndex((t) => t.key === tab);
    const next =
      event.key === "ArrowRight"
        ? at + 1
        : event.key === "ArrowLeft"
          ? at - 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? TABS.length - 1
              : null;
    if (next === null) return;
    event.preventDefault();
    const to = TABS[(next + TABS.length) % TABS.length];
    if (!to) return;
    onSelect(to.key);
    document.getElementById(tabId(to.key))?.focus();
  };
  return (
    <div
      className="es-tabs"
      role="tablist"
      aria-label="Book information"
      tabIndex={-1}
      hidden={hidden}
      onKeyDown={onKeyDown}
    >
      {TABS.map(({ key, label }) => (
        <button
          key={key}
          type="button"
          role="tab"
          id={tabId(key)}
          className="es-tab"
          aria-selected={tab === key}
          aria-controls={panelId(key)}
          tabIndex={tab === key ? 0 : -1}
          data-edited={edited[key] ? "" : undefined}
          onClick={() => onSelect(key)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** One tab's panel, hidden while another tab or the fetch view shows. */
export function Panel({
  tab,
  current,
  fetching,
  children,
}: {
  tab: TabKey;
  current: TabKey;
  fetching: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className="es-panel"
      role="tabpanel"
      id={panelId(tab)}
      aria-labelledby={tabId(tab)}
      hidden={fetching || tab !== current}
    >
      {children}
    </div>
  );
}

/** The identifiers the file carries, as they are written; a scheme it didn't name reads "Type unknown". */
export function IdentifiersPanel({
  identifiers,
}: {
  identifiers: Inspected["identifiers"];
}) {
  if (identifiers.length === 0) {
    return <p className="es-quiet">This book carries no identifiers.</p>;
  }
  return (
    <dl className="es-idents" data-testid="es-identifiers">
      {identifiers.map((ident, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the same value can be listed under two schemes, and the list is read-only
        <div key={i}>
          <dt>{ident.scheme?.trim() || "Type unknown"}</dt>
          <dd>{ident.value}</dd>
        </div>
      ))}
    </dl>
  );
}
