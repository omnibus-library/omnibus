import type { ReactNode } from "react";
import type { ShelfDetail } from "../../api";
import { kindLabel, ruleText, visibilityLabel } from "./rules";
import "./ShelfForm.css";

/** The shelf's kind, visibility and (on a smart shelf) one chip per rule; `children` sit between. */
export function ShelfFacets({
  shelf,
  children,
}: {
  shelf: Pick<ShelfDetail, "kind" | "visibility" | "rules">;
  children?: ReactNode;
}) {
  return (
    <div className="shelf-facets" data-testid="shelf-facets">
      <span className="shelf-facet shelf-facet--kind">
        {kindLabel(shelf.kind)}
      </span>
      <span className="shelf-facet-dot">·</span>
      <span className="shelf-facet">{visibilityLabel(shelf.visibility)}</span>
      {children}
      {shelf.kind === "smart" &&
        shelf.rules.map((rule, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: two rules can read alike
          <span key={i} className="shelf-rule-chip">
            {ruleText(rule)}
          </span>
        ))}
    </div>
  );
}
