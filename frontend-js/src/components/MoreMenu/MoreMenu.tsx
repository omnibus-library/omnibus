import { type KeyboardEvent, type ReactNode, useEffect, useRef } from "react";
import "./MoreMenu.css";

export type MoreMenuItem = {
  label: string;
  testId: string;
  onSelect: () => void;
  danger?: boolean;
  /** Makes the item a checkbox (a radio under `radio`); any checked item gives every item the check gutter. */
  checked?: boolean;
  disabled?: boolean;
  /** A mark before the label. */
  icon?: ReactNode;
  /** Quiet words after the label. */
  note?: string;
};

const ITEMS = '[role^="menuitem"]:not(:disabled)';

/**
 * The ⋯ menu's popup over a click-away scrim; choosing an item closes it first. Focus starts on
 * the checked item, else the first; the arrows, Home and End move it; Escape and Tab close;
 * closing hands focus back to what opened it.
 */
export function MoreMenu({
  label,
  items,
  onClose,
  radio = false,
}: {
  label: string;
  items: MoreMenuItem[];
  onClose: () => void;
  /** Checked items are one choice among several: `menuitemradio`, not `menuitemcheckbox`. */
  radio?: boolean;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const gutter = items.some((item) => item.checked !== undefined);
  useEffect(() => {
    const opener = document.activeElement;
    const all = [...(menu.current?.querySelectorAll<HTMLElement>(ITEMS) ?? [])];
    (
      all.find((el) => el.getAttribute("aria-checked") === "true") ?? all[0]
    )?.focus();
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" || event.key === "Tab") {
      if (event.key === "Escape") event.preventDefault();
      return onClose();
    }
    const all = [...event.currentTarget.querySelectorAll<HTMLElement>(ITEMS)];
    const at = all.indexOf(document.activeElement as HTMLElement);
    const to: Record<string, number> = {
      ArrowDown: at + 1,
      ArrowUp: at < 0 ? all.length - 1 : at - 1,
      Home: 0,
      End: all.length - 1,
    };
    const next = to[event.key];
    if (next === undefined || all.length === 0) return;
    event.preventDefault();
    all[(next + all.length) % all.length]?.focus();
  };
  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: a click-away scrim; the menu closes from the keyboard with Escape */}
      <div className="shd-menu-scrim" onClick={onClose} />
      <div
        ref={menu}
        className="shelf-actions-menu shd-menu"
        role="menu"
        aria-label={label}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        {items.map((item) => (
          <button
            key={item.testId}
            type="button"
            className={
              item.danger
                ? "shelf-menu-item shelf-menu-item--danger shd-menu-item"
                : "shelf-menu-item shd-menu-item"
            }
            {...(item.checked === undefined
              ? { role: "menuitem" }
              : {
                  role: radio ? "menuitemradio" : "menuitemcheckbox",
                  "aria-checked": item.checked,
                })}
            data-testid={item.testId}
            disabled={item.disabled}
            onClick={() => {
              onClose();
              item.onSelect();
            }}
          >
            {gutter && !item.icon && (
              <span className="shd-menu-check" aria-hidden="true">
                {item.checked && "✓"}
              </span>
            )}
            {item.icon && (
              <span className="shd-menu-icon" aria-hidden="true">
                {item.icon}
              </span>
            )}
            {item.label}
            {item.note && <span className="shd-menu-note">{item.note}</span>}
          </button>
        ))}
      </div>
    </>
  );
}
