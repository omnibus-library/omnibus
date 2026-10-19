import type { BookDetail, Highlight } from "../../api";
import type { AnnotationTarget } from "./annotations";
import { NoteComposer } from "./NoteComposer";
import { QuotePanel } from "./QuotePanel";

type AnnotationTargetsProps = {
  target: AnnotationTarget | null;
  book: Pick<BookDetail, "title" | "authors" | "accent"> | null | undefined;
  onSave: (highlight: Highlight, draft: string) => void;
  onClose: () => void;
};

/** The quote card or note composer for the passage a row action picked; nothing while there is no target. */
export function AnnotationTargets({
  target,
  book,
  onSave,
  onClose,
}: AnnotationTargetsProps) {
  if (target?.kind === "quote") {
    return (
      <QuotePanel
        text={target.highlight.text ?? ""}
        author={book?.authors[0] ?? ""}
        subtitle={book?.title ?? ""}
        accent={book?.accent ?? "#3a3027"}
        onClose={onClose}
      />
    );
  }
  if (target?.kind === "note") {
    return (
      <NoteComposer
        highlight={target.highlight}
        onSave={(draft) => onSave(target.highlight, draft)}
        onClose={onClose}
      />
    );
  }
  return null;
}
