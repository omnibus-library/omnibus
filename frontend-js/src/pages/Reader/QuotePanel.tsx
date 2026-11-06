import type { BookUuid } from "../../api";
import { QuoteCard } from "../../components/QuoteCard/QuoteCard";
import { Scrim } from "./DrawerShell";

type QuotePanelProps = {
  text: string;
  author: string;
  /** The book's title. */
  subtitle: string;
  uuid: BookUuid;
  accent: string | null;
  onClose: () => void;
};

/** The reader's drawer around the quote-card editor. */
export function QuotePanel({
  text,
  author,
  subtitle,
  uuid,
  accent,
  onClose,
}: QuotePanelProps) {
  return (
    <>
      <Scrim onClick={onClose} />
      <div
        className="rd-drawer rd-quote-drawer"
        data-testid="reader-quote-drawer"
      >
        <div className="rd-grabber" />
        <QuoteCard
          text={text}
          author={author}
          subtitle={subtitle}
          uuid={uuid}
          accent={accent}
          onClose={onClose}
        />
      </div>
    </>
  );
}
