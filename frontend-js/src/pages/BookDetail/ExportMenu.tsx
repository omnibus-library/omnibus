import { useEffect, useRef, useState } from "react";
import type { BookDetail } from "../../api";
import { Button } from "../../components/Button/Button";
import { SendToKobo } from "../../components/FormatSwitcher/FormatSwitcher";
import {
  KINDLE_WEB_UPLOAD_URL,
  kindleOversize,
  SendToKindle,
} from "../../components/FormatSwitcher/SendToKindle";

/** The Export dropdown: every send or download the book supports, behind one button. */
export function ExportMenu({ book }: { book: BookDetail }) {
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    // After paint, or the focus ring never shows.
    const frame = requestAnimationFrame(() => panel.current?.focus());
    // On the window, since a send button disabling itself drops focus out of the panel.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);
  const close = () => setOpen(false);
  const { uuid, hasEbook, hasAudio, hasPdf } = book;
  // Amazon takes an EPUB or a PDF as it is.
  const kindle = hasEbook || hasPdf;
  return (
    <div className="bd-export">
      <Button
        variant="ghost"
        size="lg"
        className="bd-export-trigger"
        data-testid="hero-export"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
      >
        Export
        <span className="bd-export-caret" aria-hidden="true">
          ▾
        </span>
      </Button>
      {open && (
        <div
          className="bd-export-scrim"
          data-testid="hero-export-scrim"
          aria-hidden="true"
          onClick={close}
        />
      )}
      {/* Mounted while closed so a send in flight still reports how it went. */}
      <div
        ref={panel}
        className="bd-export-panel card"
        // Not display: none, which would hide the send toast inside it too.
        style={open ? undefined : { visibility: "hidden" }}
        role="dialog"
        aria-label="Export options"
        data-testid="hero-export-panel"
        tabIndex={-1}
      >
        {(hasEbook || hasPdf) && (
          // A plain anchor, so the browser downloads; /download serves the EPUB, else the PDF.
          <a
            className="bd-export-item"
            data-testid="export-download-epub"
            href={`/api/ebooks/${uuid}/download`}
            download=""
            onClick={close}
          >
            <span className="bd-export-item-label">
              {hasEbook ? "Download EPUB" : "Download PDF"}
            </span>
          </a>
        )}
        {hasAudio && (
          <a
            className="bd-export-item"
            data-testid="export-download-audio"
            href={`/api/audiobooks/${uuid}/download`}
            download=""
            onClick={close}
          >
            <span className="bd-export-item-label">Download audiobook</span>
          </a>
        )}
        {kindle &&
          (kindleOversize(book.epubSizeBytes ?? 0) ? (
            <>
              <div
                className="bd-export-item bd-export-item-muted"
                data-testid="hero-send-kindle-oversize"
                aria-disabled="true"
              >
                <span className="bd-export-item-label">Send to Kindle</span>
              </div>
              <a
                className="bd-export-subnote"
                data-testid="hero-send-kindle-web-link"
                href={KINDLE_WEB_UPLOAD_URL}
                target="_blank"
                rel="noopener noreferrer"
                onClick={close}
              >
                Too large to email. Upload it on Amazon's Send to Kindle page
                (up to 200 MB) →
              </a>
            </>
          ) : (
            <SendToKindle
              uuid={uuid}
              className="bd-export-item"
              testId="hero-send-kindle"
            />
          ))}
        {hasEbook && (
          <SendToKobo
            uuid={uuid}
            className="bd-export-item"
            testId="hero-send-kobo"
          />
        )}
      </div>
    </div>
  );
}
