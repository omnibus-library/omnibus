import type { ReactNode } from "react";
import { PageTitle } from "../PageTitle/PageTitle";
import "./Unported.css";

type UnportedProps = {
  title: string;
  /** Where the Dioxus version lives, relative to the repo root. */
  source: string;
  /** Route parameters, shown so the stub proves the route parsed them. */
  params?: Record<string, string | null | undefined>;
  children?: ReactNode;
};

/** A route that exists but whose screen hasn't been ported from Dioxus yet. */
export function Unported({
  title,
  source,
  params = {},
  children,
}: UnportedProps) {
  const shown = Object.entries(params);
  return (
    <section className="unported">
      <PageTitle page={title} />
      <p className="label">Not ported yet</p>
      <h1 className="unported-title">{title}</h1>
      {shown.length > 0 && (
        <dl className="unported-params">
          {shown.map(([name, value]) => (
            <div key={name}>
              <dt className="label">{name}</dt>
              <dd>{value ?? "—"}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className="unported-source">
        Dioxus source: <code>{source}</code>
      </p>
      {children && <div className="unported-actions">{children}</div>}
    </section>
  );
}
