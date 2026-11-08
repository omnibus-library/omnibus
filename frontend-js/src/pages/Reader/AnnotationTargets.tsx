import type { BookDetail, BookUuid, Highlight } from "../../api";
import type { AnnotationTarget } from "./annotations";
import { NoteComposer } from "./NoteComposer";
import { QuotePanel } from "./QuotePanel";

type AnnotationTargetsProps = {
  uuid: BookUuid;
  target: AnnotationTarget | null;
  book: Pick<BookDetail, "title" | "authors" | "accent"> | null | undefined;
  onSave: (highlight: Highlight, draft: string) => void;
  onClose: () => void;
};

/** The quote card or note composer for the passage a row action picked; nothing while there is no target. */
export function AnnotationTargets({
  uuid,
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
        uuid={uuid}
        accent={book?.accent ?? null}
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
