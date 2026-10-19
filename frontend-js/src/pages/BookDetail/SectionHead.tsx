import type { ReactNode } from "react";

/** A section's kicker over its title, with an optional action opposite. */
export function SectionHead({
  kicker,
  title,
  action,
}: {
  kicker: string;
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="bd-section-head">
      <div className="bd-section-head-text">
        {kicker && <div className="label bd-section-kicker">{kicker}</div>}
        <h3 className="bd-section-title">{title}</h3>
      </div>
      {action}
    </div>
  );
}
