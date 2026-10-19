import { useCallback, useState } from "react";
import {
  type BookUuid,
  createHighlight,
  deleteHighlight,
  type Highlight,
  type HighlightColor,
  recolorHighlight,
  saveHighlightNote,
} from "../../api";
import { withReader } from "./epubGlue";
import { isEpubCfi } from "./start";

export const HIGHLIGHT_COLORS = [
  "amber",
  "green",
  "blue",
  "rose",
  "violet",
] as const satisfies readonly HighlightColor[];

/** How the highlight UI reaches the viewer that paints annotations: the EPUB reader's is epub.js, the PDF reader's PDF.js. */
export type AnnotationBridge = {
  /** Show the passage at `anchor`. */
  navigate(anchor: string): void;
  paint(anchor: string, color: HighlightColor): void;
  unpaint(anchor: string): void;
  copy(text: string): void;
};

// A Kobo highlight has no CFI and a PDF highlight a `pdf:` anchor: nothing epub.js can paint.
export const epubBridge: AnnotationBridge = {
  navigate: (anchor) => withReader((glue) => glue.display(anchor)),
  paint(anchor, color) {
    if (isEpubCfi(anchor))
      withReader((glue) => glue.addAnnotation(anchor, color));
  },
  unpaint(anchor) {
    if (isEpubCfi(anchor)) withReader((glue) => glue.removeAnnotation(anchor));
  },
  copy: (text) => withReader((glue) => glue.copyText(text)),
};

/** A passage to write a note on, or to make a quote card of. */
export type AnnotationTarget = { kind: "note" | "quote"; highlight: Highlight };

/**
 * A book's highlights and the note or quote panel open on one. A new highlight is painted at once
 * and unpainted again if saving it fails; `after` opens the panel the action asked for on the saved row.
 */
export function useHighlights(uuid: BookUuid, bridge: AnnotationBridge) {
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [target, setTarget] = useState<AnnotationTarget | null>(null);

  const load = useCallback(
    (saved: Highlight[]) => {
      for (const h of saved)
        if (h.anchor !== null) bridge.paint(h.anchor, h.color);
      setHighlights(saved);
    },
    [bridge],
  );

  async function create(
    passage: { anchor: string; color: HighlightColor; text: string },
    after: AnnotationTarget["kind"] | null,
  ) {
    bridge.paint(passage.anchor, passage.color);
    let saved: Highlight;
    try {
      saved = await createHighlight(uuid, passage);
    } catch {
      bridge.unpaint(passage.anchor);
      return;
    }
    setHighlights((list) => [...list, saved]);
    if (after) setTarget({ kind: after, highlight: saved });
  }

  /** Saves the note (blank removes it) and closes the composer; a failed save leaves it open. */
  async function saveNote(highlight: Highlight, draft: string) {
    const note = draft.trim() || null;
    try {
      await saveHighlightNote(highlight.id, note);
    } catch {
      return;
    }
    setHighlights((list) =>
      list.map((h) => (h.id === highlight.id ? { ...h, note } : h)),
    );
    setTarget(null);
  }

  /** Recolors a passage once the server has it, so a refused change leaves the row and the painted color as they were. */
  async function recolor(highlight: Highlight, color: HighlightColor) {
    if (color === highlight.color) return;
    try {
      await recolorHighlight(highlight.id, color);
    } catch {
      return;
    }
    if (highlight.anchor !== null) {
      bridge.unpaint(highlight.anchor);
      bridge.paint(highlight.anchor, color);
    }
    setHighlights((list) =>
      list.map((h) => (h.id === highlight.id ? { ...h, color } : h)),
    );
  }

  /** Deletes a passage and unpaints it; a refused delete keeps both. */
  async function remove(highlight: Highlight) {
    try {
      await deleteHighlight(highlight.id);
    } catch {
      return;
    }
    if (highlight.anchor !== null) bridge.unpaint(highlight.anchor);
    setHighlights((list) => list.filter((h) => h.id !== highlight.id));
  }

  return {
    highlights,
    target,
    setTarget,
    load,
    create,
    saveNote,
    recolor,
    remove,
  };
}
