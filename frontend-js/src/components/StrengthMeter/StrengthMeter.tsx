import type { PasswordStrength, StrengthScore } from "../../password";
import "./StrengthMeter.css";

const TIER: Record<StrengthScore, string> = {
  0: "auth-strength-tier-none",
  1: "auth-strength-tier-bad",
  2: "auth-strength-tier-warn",
  3: "auth-strength-tier-mid",
  4: "auth-strength-tier-ok",
};

const SEGMENTS = [0, 1, 2, 3] as const;

/** The four-segment strength meter and the password requirements checklist. */
export function StrengthMeter({ strength }: { strength: PasswordStrength }) {
  const tier = TIER[strength.score];
  return (
    <>
      <div className="auth-strength">
        {/* biome-ignore lint/a11y/useSemanticElements: a native <meter> can't hold the four styled segments */}
        <div
          className={`auth-strength-bar ${tier}`}
          role="meter"
          aria-label="Password strength"
          aria-valuemin={0}
          aria-valuemax={4}
          aria-valuenow={strength.score}
        >
          {SEGMENTS.map((i) => (
            <div
              key={i}
              className={
                i < strength.score
                  ? "auth-strength-segment auth-strength-segment-on"
                  : "auth-strength-segment"
              }
            />
          ))}
        </div>
        <div className="auth-strength-label">
          <span className="auth-strength-label-lhs">strength</span>
          <span className={`auth-strength-label-rhs ${tier}`}>
            {strength.label}
          </span>
        </div>
      </div>
      <div className="auth-requirements">
        <div className="auth-requirements-title">Password needs</div>
        <Requirement ok={strength.rules.length} text="At least 10 characters" />
        <Requirement ok={strength.rules.mixedCase} text="Mixed case" />
        <Requirement
          ok={strength.rules.numberOrSymbol}
          text="One number or symbol"
        />
      </div>
    </>
  );
}

// The status is spoken too, so the dot's colour is never the only signal.
function Requirement({ ok, text }: { ok: boolean; text: string }) {
  return (
    <div className={ok ? "auth-req ok" : "auth-req"}>
      <span className="auth-req-dot" aria-hidden="true" />
      <span>{text}</span>
      <span className="sr-only">: {ok ? "met" : "not met"}</span>
    </div>
  );
}
