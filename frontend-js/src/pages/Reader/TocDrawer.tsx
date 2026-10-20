import { classes } from "../../classes";
import { DrawerShell } from "./DrawerShell";
import type { TocEntry } from "./epubGlue";

type TocDrawerProps = {
  entries: TocEntry[];
  /** The reader's current chapter, whose entry is marked. */
  currentTitle: string;
  /** The phone sheet's "184 / 272 · 68%" line. */
  progressLabel: string;
  onNavigate: (href: string) => void;
  onClose: () => void;
};

/** The contents drawer: the book's flattened TOC, indented by level. */
export function TocDrawer({
  entries,
  currentTitle,
  progressLabel,
  onNavigate,
  onClose,
}: TocDrawerProps) {
  return (
    <DrawerShell
      testId="reader-toc-drawer"
      onClose={onClose}
      head={
        <>
          <h4 className="rd-drawer-title">Contents</h4>
          {progressLabel && (
            <span className="rd-drawer-sub">{progressLabel}</span>
          )}
        </>
      }
    >
      <div className="rd-drawer-body">
        {entries.length === 0 ? (
          <div className="rd-drawer-empty">No table of contents.</div>
        ) : (
          entries.map((entry) => (
            <button
              key={`${entry.href}|${entry.label}`}
              type="button"
              className={classes(
                "rd-toc-row",
                currentTitle !== "" &&
                  entry.label === currentTitle &&
                  "current",
              )}
              style={{ paddingLeft: 14 + entry.level * 16 }}
              data-testid="reader-toc-row"
              onClick={() => onNavigate(entry.href)}
            >
              {entry.label}
            </button>
          ))
        )}
      </div>
    </DrawerShell>
  );
}
