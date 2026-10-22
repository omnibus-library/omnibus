import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { prefersReducedMotion } from "../../motion";
import { turnMode, turnPage } from "../../viewTransition";

export const TABS = [
  { id: "overview", label: "Overview" },
  { id: "reviews", label: "Reviews" },
  { id: "highlights", label: "Highlights & Journal", short: "Highlights" },
  { id: "files", label: "Files & Details", short: "Files" },
] as const;

export type TabId = (typeof TABS)[number]["id"];

const indexOf = (id: TabId) => TABS.findIndex((tab) => tab.id === id);

/** The open tab and how to change it. The swap is a page turn, and `--dir` tells the turn which way to go. */
export function useBookTabs() {
  const [tab, setTab] = useState<TabId>("overview");
  // Only without View Transitions: the page that just opened plays its own entrance.
  const [entering, setEntering] = useState<TabId | null>(null);
  /** Resolves once the new panel is in the DOM, so a caller can focus or scroll within it. */
  const selectTab = useCallback(
    (next: TabId): Promise<void> => {
      if (next === tab) return Promise.resolve();
      document.documentElement.style.setProperty(
        "--dir",
        indexOf(next) > indexOf(tab) ? "1" : "-1",
      );
      const css = turnMode() === "css";
      return turnPage(() => {
        setTab(next);
        setEntering(css ? next : null);
      });
    },
    [tab],
  );
  return { tab, entering, selectTab };
}

const tabId = (id: TabId) => `bp-tab-${id}`;
const panelId = (id: TabId) => `bp-panel-${id}`;

type BookTabsProps = {
  tab: TabId;
  entering: TabId | null;
  onSelect: (tab: TabId) => void;
  /** All four stay mounted: a hidden one keeps its drafts and its queue. */
  panels: Record<TabId, ReactNode>;
};

/** The tab strip with its ribbon bookmark, over the panels it switches between. */
export function BookTabs({ tab, entering, onSelect, panels }: BookTabsProps) {
  const list = useRef<HTMLDivElement>(null);
  const ribbon = useRef<HTMLSpanElement>(null);
  const placed = useRef(false);
  const [left, setLeft] = useState(0);
  // Resizes and font loads move the ribbon at once; only a new selection makes it slide.
  const [sliding, setSliding] = useState(false);
  const [swings, setSwings] = useState(0);

  // `left`, from the open tab's measured centre, never a transform.
  const place = useCallback((slide: boolean) => {
    const box = list.current;
    const bookmark = ribbon.current;
    const open = box?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!box || !bookmark || !open) return;
    const [tabBox, listBox] = [
      open.getBoundingClientRect(),
      box.getBoundingClientRect(),
    ];
    setSliding(slide);
    setLeft(
      tabBox.left - listBox.left + tabBox.width / 2 - bookmark.offsetWidth / 2,
    );
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new selection is what moves the ribbon
  useLayoutEffect(() => {
    place(placed.current);
    if (placed.current && !prefersReducedMotion()) setSwings((n) => n + 1);
    placed.current = true;
  }, [tab, place]);

  useEffect(() => {
    const box = list.current;
    if (!box) return;
    const watch = new ResizeObserver(() => place(false));
    watch.observe(box);
    void document.fonts?.ready.then(() => place(false));
    return () => watch.disconnect();
  }, [place]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // From the focused tab, which moves at once, not the open one, which lags the page turn.
    const at = TABS.findIndex(
      (item) =>
        event.target instanceof Element && event.target.id === tabId(item.id),
    );
    if (at < 0) return;
    const targets: Record<string, number> = {
      ArrowRight: at + 1,
      ArrowLeft: at - 1,
      Home: 0,
      End: TABS.length - 1,
    };
    const to = targets[event.key];
    if (to === undefined) return;
    event.preventDefault();
    const next = TABS[(to + TABS.length) % TABS.length];
    if (!next) return;
    onSelect(next.id);
    list.current?.querySelector<HTMLElement>(`#${tabId(next.id)}`)?.focus();
  };

  return (
    <>
      <div className="bp-tabs">
        <div
          ref={list}
          className="bp-tablist"
          role="tablist"
          aria-label="Book sections"
          onKeyDown={onKeyDown}
        >
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={tabId(item.id)}
              className="bp-tab"
              aria-controls={panelId(item.id)}
              // Under 720 px the visible text is the short one; the name stays whole.
              aria-label={item.label}
              aria-selected={tab === item.id}
              tabIndex={tab === item.id ? 0 : -1}
              onClick={() => onSelect(item.id)}
            >
              {"short" in item ? (
                <>
                  {item.short}
                  <span className="bp-tab-long">
                    {item.label.slice(item.short.length)}
                  </span>
                </>
              ) : (
                item.label
              )}
            </button>
          ))}
          <span
            ref={ribbon}
            className="bp-ribbon"
            style={{ left, transition: sliding ? undefined : "none" }}
            aria-hidden="true"
          >
            <svg
              key={swings}
              className={swings > 0 ? "is-swinging" : undefined}
              viewBox="0 0 22 46"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <path className="bp-ribbon-cloth" d="M0 0H22V46L11 38L0 46Z" />
              <path d="M0 0H22V4H0Z" fill="#000" fillOpacity="0.35" />
              <path
                d="M3.5 6V41M18.5 6V41"
                stroke="#fff"
                strokeOpacity="0.18"
                strokeWidth="1"
                strokeDasharray="2 2"
              />
            </svg>
          </span>
        </div>
      </div>
      <div className="bp-page">
        <div className="bp-panels">
          {TABS.map((item) => (
            <section
              key={item.id}
              id={panelId(item.id)}
              className={
                entering === item.id ? "bp-panel bp-page-enter" : "bp-panel"
              }
              role="tabpanel"
              aria-labelledby={tabId(item.id)}
              hidden={tab !== item.id}
            >
              {panels[item.id]}
            </section>
          ))}
        </div>
      </div>
    </>
  );
}
