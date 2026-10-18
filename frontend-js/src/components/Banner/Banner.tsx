import type { ReactNode } from "react";
import "./Banner.css";

export type BannerKind = "err" | "warn" | "info" | "ok";

const LOOK = {
  err: { className: "auth-banner auth-banner-err", icon: "!", role: "alert" },
  warn: {
    className: "auth-banner auth-banner-warn",
    icon: "!",
    role: "status",
  },
  info: {
    className: "auth-banner auth-banner-info",
    icon: "i",
    role: "status",
  },
  ok: { className: "auth-banner auth-banner-ok", icon: "✓", role: "status" },
} satisfies Record<
  BannerKind,
  { className: string; icon: string; role: string }
>;

type BannerProps = {
  kind: BannerKind;
  title: string;
  message?: string;
  children?: ReactNode;
};

/** A message strip; errors are `alert` so a screen reader interrupts for them. */
export function Banner({ kind, title, message, children }: BannerProps) {
  const look = LOOK[kind];
  return (
    <div className={look.className} role={look.role}>
      <div className="auth-banner-icon">{look.icon}</div>
      <div className="auth-banner-body">
        <div className="auth-banner-title">{title}</div>
        {message && <div className="auth-banner-message">{message}</div>}
        {children && <div className="auth-banner-action">{children}</div>}
      </div>
    </div>
  );
}
