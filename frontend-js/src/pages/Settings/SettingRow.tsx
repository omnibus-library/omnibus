import type { ReactNode } from "react";

type SettingRowProps = {
  label: string;
  description: string;
  controlId: string;
  testId?: string;
  children: ReactNode;
};

/** A setting's name and what it does on the left, its control on the right. */
export function SettingRow({
  label,
  description,
  controlId,
  testId,
  children,
}: SettingRowProps) {
  return (
    <div className="setting-row" data-testid={testId}>
      <div className="setting-row-text">
        <label className="setting-row-label" htmlFor={controlId}>
          {label}
        </label>
        <p className="setting-row-desc" id={`${controlId}-desc`}>
          {description}
        </p>
      </div>
      <div className="setting-row-control">{children}</div>
    </div>
  );
}

/** The inline result beside an autosaving control: a live region mounted before the first save so that save is announced. */
export function SaveStatus({
  testId,
  save,
}: {
  testId: string;
  save: {
    isPending: boolean;
    isError: boolean;
    isSuccess: boolean;
    error: Error | null;
  };
}) {
  const { isPending, isError, isSuccess, error } = save;
  let text = "";
  if (isPending) text = "Saving…";
  else if (isError) text = `Couldn’t save: ${error?.message}`;
  else if (isSuccess) text = "Saved";
  const className = isError
    ? "pref-status error"
    : isPending
      ? "pref-status ld-sheen"
      : "pref-status";
  return (
    <span role="status" className={className} data-testid={testId}>
      {text}
    </span>
  );
}
