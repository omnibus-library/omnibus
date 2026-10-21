// Presentational only, as on the Dioxus page: the server still enforces policy.

export type StrengthScore = 0 | 1 | 2 | 3 | 4;

export type PasswordStrength = {
  score: StrengthScore;
  label: "empty" | "weak" | "fair" | "good" | "strong";
  rules: { length: boolean; mixedCase: boolean; numberOrSymbol: boolean };
};

const SCORES = [0, 1, 2, 3, 4] as const satisfies readonly StrengthScore[];

// A typed password is never "empty", however weak.
const LABELS = {
  0: "weak",
  1: "weak",
  2: "fair",
  3: "good",
  4: "strong",
} as const satisfies Record<StrengthScore, PasswordStrength["label"]>;

/** The strength meter's score and label, and the requirements checklist. */
export function scorePassword(password: string): PasswordStrength {
  const length = Array.from(password).length;
  const rules = {
    length: length >= 10,
    mixedCase: /[a-z]/.test(password) && /[A-Z]/.test(password),
    numberOrSymbol: /[0-9]|[^\p{L}\p{N}]/u.test(password),
  };
  const points = [
    length >= 4,
    length >= 8,
    rules.mixedCase,
    rules.numberOrSymbol,
    rules.length,
  ].filter(Boolean).length;
  const score = SCORES[Math.min(points, 4)] ?? 4;
  return { score, label: password ? LABELS[score] : "empty", rules };
}
