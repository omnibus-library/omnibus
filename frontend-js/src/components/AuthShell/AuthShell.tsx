import type { ReactNode } from "react";
import brandMark from "../../assets/omnibus-stoat.png";
import "./AuthShell.css";

const SPINES = [
  {
    className: "auth-shell-spine auth-shell-spine-0",
    color: "oklch(0.66 0.13 245)",
  },
  {
    className: "auth-shell-spine auth-shell-spine-1",
    color: "oklch(0.70 0.13 95)",
  },
  {
    className: "auth-shell-spine auth-shell-spine-2",
    color: "oklch(0.55 0.11 145)",
  },
  {
    className: "auth-shell-spine auth-shell-spine-3",
    color: "oklch(0.74 0.08 220)",
  },
  {
    className: "auth-shell-spine auth-shell-spine-4",
    color: "oklch(0.55 0.14 35)",
  },
  {
    className: "auth-shell-spine auth-shell-spine-5",
    color: "oklch(0.45 0.15 295)",
  },
  {
    className: "auth-shell-spine auth-shell-spine-6",
    color: "oklch(0.78 0.09 75)",
  },
  {
    className: "auth-shell-spine auth-shell-spine-7",
    color: "oklch(0.55 0.12 165)",
  },
  {
    className: "auth-shell-spine auth-shell-spine-8",
    color: "oklch(0.60 0.14 30)",
  },
];

function ShelfArt() {
  return (
    <aside className="auth-shell-art">
      <div className="auth-shell-brand">
        <img className="auth-shell-brand-mark" src={brandMark} alt="" />
        <div className="auth-shell-brand-word">Omnibus</div>
      </div>
      <div className="auth-shell-shelf" aria-hidden="true">
        <div className="auth-shell-spines">
          {SPINES.map((spine) => (
            <div
              key={spine.className}
              className={spine.className}
              style={{ background: spine.color }}
            >
              <span className="auth-shell-spine-dot" />
            </div>
          ))}
        </div>
        <div className="auth-shell-shelf-plank" />
      </div>
      <div className="auth-shell-tagline">
        <h1 className="auth-shell-headline">
          Your <span className="auth-shell-headline-em">shelf</span>, anywhere.
        </h1>
        <p className="auth-shell-blurb">
          One library for ebooks, audiobooks, journals and quotes — synced
          across the devices you already own.
        </p>
        <div className="auth-shell-meta">
          <span>self-hosted</span>
          <span>·</span>
          <span>open source</span>
          <span>·</span>
          <span>made with react</span>
        </div>
      </div>
    </aside>
  );
}

/** Highlights a word of a title the way the shell's headline does. */
export function Emphasis({ children }: { children: ReactNode }) {
  return <span className="auth-shell-headline-em">{children}</span>;
}

type AuthShellProps = {
  kicker: string;
  title: ReactNode;
  lede: string;
  children: ReactNode;
};

/** The signed-out frame: the shelf art beside a form column. */
export function AuthShell({ kicker, title, lede, children }: AuthShellProps) {
  return (
    <div className="auth-shell-grid">
      <ShelfArt />
      <section className="auth-shell-form">
        <div className="auth-shell-form-inner">
          <div className="auth-shell-kicker">{kicker}</div>
          <h2 className="auth-shell-title">{title}</h2>
          <p className="auth-shell-lede">{lede}</p>
          <div className="auth-shell-body">{children}</div>
        </div>
      </section>
    </div>
  );
}
