import type { MetadataLibrary, MetadataSource } from "../../api";
import type { Status } from "../../components/SettingsShell/SettingsShell";

export type Direction = "up" | "down";

const LABELS = {
  folder_structure: "Folder structure",
  embedded_tags: "Embedded tags",
  opf_sidecar: "OPF sidecar",
  omnibus_overrides: "Manual edits (overrides)",
  provider_match: "Provider match (Hardcover)",
} satisfies Record<MetadataSource, string>;

export const sourceLabel = (source: MetadataSource) => LABELS[source];

/** `order` with the source at `from` swapped one place, that source and where it landed; null at either end. */
export function moveSource(
  order: readonly MetadataSource[],
  from: number,
  direction: Direction,
): { order: MetadataSource[]; landed: number; source: MetadataSource } | null {
  const landed = direction === "up" ? from - 1 : from + 1;
  const moved = order[from];
  const displaced = order[landed];
  if (moved === undefined || displaced === undefined) return null;
  const next = [...order];
  next[landed] = moved;
  next[from] = displaced;
  return { order: next, landed, source: moved };
}

/** The button that keeps focus after a move: the one pressed, unless the source reached the end that disables it. */
export function focusAfterMove({
  index,
  len,
  pressed,
}: {
  index: number;
  len: number;
  pressed: Direction;
}): Direction {
  if (pressed === "up" && index === 0) return "down";
  if (pressed === "down" && index === len - 1) return "up";
  return pressed;
}

/** What the live region says after a move. */
export function positionAnnouncement({
  source,
  index,
  len,
}: {
  source: MetadataSource;
  index: number;
  len: number;
}): string {
  return `${sourceLabel(source)} moved to position ${index + 1} of ${len}.`;
}

/** The draft, when it is loaded and differs from the saved order. */
export function changedOrder(
  draft: readonly MetadataSource[] | null,
  saved: readonly MetadataSource[] | null,
): readonly MetadataSource[] | null {
  if (draft === null) return null;
  const same =
    saved !== null &&
    draft.length === saved.length &&
    draft.every((source, i) => source === saved[i]);
  return same ? null : draft;
}

export type SaveOutcome = { library: MetadataLibrary; failure: string | null };

/** The status line after saving each changed list: one success line, or each refusal beside what did save. */
export function saveSummary(outcomes: readonly SaveOutcome[]): Status {
  const failures = outcomes.flatMap(({ library, failure }) =>
    failure === null ? [] : [`Couldn’t save the ${library} order: ${failure}`],
  );
  if (failures.length === 0) {
    return { message: "Metadata order saved.", error: false };
  }
  const saved = outcomes
    .filter(({ failure }) => failure === null)
    .map(({ library }) => `Saved the ${library} order.`);
  return { message: [...saved, ...failures].join(" "), error: true };
}
