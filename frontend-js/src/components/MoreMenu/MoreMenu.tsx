import "./MoreMenu.css";

export type MoreMenuItem = {
  label: string;
  testId: string;
  onSelect: () => void;
  danger?: boolean;
  /** Makes the item a checkbox; any checkbox gives every item the check gutter. */
  checked?: boolean;
  disabled?: boolean;
};

/** The ⋯ menu's popup over a click-away scrim; choosing an item closes it first. */
export function MoreMenu({
  label,
  items,
  onClose,
}: {
  label: string;
  items: MoreMenuItem[];
  onClose: () => void;
}) {
  const gutter = items.some((item) => item.checked !== undefined);
  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: a click-away scrim; the menu closes from the keyboard by choosing an item */}
      <div className="shd-menu-scrim" onClick={onClose} />
      <div
        className="shelf-actions-menu shd-menu"
        role="menu"
        aria-label={label}
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
              : { role: "menuitemcheckbox", "aria-checked": item.checked })}
            data-testid={item.testId}
            disabled={item.disabled}
            onClick={() => {
              onClose();
              item.onSelect();
            }}
          >
            {gutter && (
              <span className="shd-menu-check" aria-hidden="true">
                {item.checked && "✓"}
              </span>
            )}
            {item.label}
          </button>
        ))}
      </div>
    </>
  );
}
