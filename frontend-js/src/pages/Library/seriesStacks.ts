import type { Book, SeriesStack, StackState } from "../../api";

/** A volume of a dealt-out run, with the chrome its cell draws. */
export type Volume = {
  book: Book;
  /** "Vol. 2", or "Vol. 2 · read" once finished. */
  caption: string;
  /** The run's last volume rounds the band's far end. */
  last: boolean;
  /** The stack's front accent, for the band behind the run. */
  band: string;
  /** The lead of the stack it was dealt from: where its motion starts. */
  lead: string;
  /** Its place in series order, which staggers the deal. */
  deck: number;
};

/** One cell of the grid. */
export type GridItem =
  | { kind: "book"; book: Book }
  | { kind: "stack"; stack: SeriesStack }
  | { kind: "cap"; stack: SeriesStack }
  | { kind: "vol"; volume: Volume };

/** The cell's React key: a book's own uuid, or `stack-`/`cap-` plus its stack's lead. */
export function itemKey(item: GridItem): string {
  switch (item.kind) {
    case "book":
      return item.book.uuid;
    case "vol":
      return item.volume.book.uuid;
    case "stack":
      return `stack-${item.stack.leadUuid}`;
    case "cap":
      return `cap-${item.stack.leadUuid}`;
    default: {
      const _exhaustive: never = item;
      return _exhaustive;
    }
  }
}

const stateOf = (stack: SeriesStack, uuid: string): StackState | undefined =>
  stack.states.find((s) => s.uuid === uuid);

/** The volume shown in front: the first in progress, else the first in series order. */
export function stackFront(stack: SeriesStack): Book | undefined {
  return (
    stack.members.find((m) => {
      const state = stateOf(stack, m.uuid);
      return state?.started && !state.finished;
    }) ?? stack.members[0]
  );
}

/** The accent behind a dealt-out run: the front volume's, else the page's. */
export const bandStyle = (stack: SeriesStack) =>
  stackFront(stack)?.accent ?? "var(--accent)";

/** "Vol. N" (series index, else run position), with " · read" once the reader finished it. */
export function volumeCaption(
  stack: SeriesStack,
  book: Book,
  position: number,
): string {
  const number = book.series?.index?.trim() || String(position + 1);
  return stateOf(stack, book.uuid)?.finished
    ? `Vol. ${number} · read`
    : `Vol. ${number}`;
}

const folds = (stack: SeriesStack) => stack.members.length >= 2;

function volumes(stack: SeriesStack): Volume[] {
  const band = bandStyle(stack);
  return stack.members.map((book, i) => ({
    book,
    caption: volumeCaption(stack, book, i),
    last: i + 1 === stack.members.length,
    band,
    lead: stack.leadUuid,
    deck: i,
  }));
}

/** The grid's cells: a stack's lead row becomes the stack, or its head card and volumes when open. */
export function gridItems(
  books: Book[],
  stacks: SeriesStack[],
  open: string | null,
): GridItem[] {
  const byLead = new Map(
    stacks.filter(folds).map((stack) => [stack.leadUuid, stack]),
  );
  return books.flatMap((book): GridItem[] => {
    const stack = byLead.get(book.uuid);
    if (!stack) return [{ kind: "book", book }];
    if (open !== stack.leadUuid) return [{ kind: "stack", stack }];
    return [
      { kind: "cap", stack },
      ...volumes(stack).map((volume): GridItem => ({ kind: "vol", volume })),
    ];
  });
}

/** The covers a folded stack fans: the front volume, then series order, at most three. */
export function stackLeaves(stack: SeriesStack): Book[] {
  const front = stackFront(stack);
  return [
    ...(front ? [front] : []),
    ...stack.members.filter((m) => m.uuid !== front?.uuid),
  ].slice(0, 3);
}

/** Per-volume segment fill (0-100) in series order; `null` until the reader starts one. */
export function stackSegments(stack: SeriesStack): number[] | null {
  if (!stack.states.some((s) => s.started || s.finished)) return null;
  return stack.members.map((m) => {
    const state = stateOf(stack, m.uuid);
    if (!state) return 0;
    return state.finished ? 100 : Math.min(state.percent ?? 0, 100);
  });
}
