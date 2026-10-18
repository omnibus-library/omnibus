import type { ReactNode } from "react";
import "./DiscPage.css";

/** The discovery pages' column: authors, series, and the not-found page. */
export function DiscPage({ children }: { children: ReactNode }) {
  return (
    <div className="disc-page">
      <div className="disc-body">{children}</div>
    </div>
  );
}
