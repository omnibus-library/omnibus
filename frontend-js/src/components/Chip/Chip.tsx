import type { ReactNode } from "react";
import "./Chip.css";

const TONE_CLASS = {
  plain: "chip",
  genre: "chip chip-genre",
} as const;

type ChipProps = { tone?: keyof typeof TONE_CLASS; children: ReactNode };

/** One `.chip`, as a list item: place it inside a `<ul>`. */
export function Chip({ tone = "plain", children }: ChipProps) {
  return <li className={TONE_CLASS[tone]}>{children}</li>;
}
