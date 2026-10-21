import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  type BookDetail,
  coverUrl,
  fetchMergeCandidates,
  mergeBooksInto,
} from "../../api";
import { formatYear } from "../../format";
import { useDebounced } from "../../useDebounced";
import { Button } from "../Button/Button";
import { ConfirmModal } from "../ConfirmModal/ConfirmModal";
import { Cover } from "../Cover/Cover";
import { SearchGlyph } from "../Glyphs/Glyphs";
import { BusyLabel } from "../Loading/Loading";

const MAX_RESULTS = 8;

// The keeper's author, then its series: what tells the reader which entry stays.
function targetSub(target: BookDetail) {
  const series = target.series
    ? `${target.series.name}${target.series.index ? ` #${target.series.index}` : ""}`
    : null;
  return [target.authors[0], series].filter(Boolean).join(" · ");
}

function TargetRail({ target }: { target: BookDetail }) {
  const sub = targetSub(target);
  return (
    <div className="mg-target-rail">
      <div className="mg-target-cover">
        <Cover
          book={target}
          src={target.hasCover ? coverUrl(target.uuid) : null}
        />
      </div>
      <div className="mg-target-main">
        <div className="label mg-target-kicker">Everything folds into</div>
        <div className="mg-target-name">
          <span className="mg-target-title">{target.title}</span>
          {sub && <span className="mono mg-target-sub">{sub}</span>}
        </div>
      </div>
      <span className="mono mg-target-note">this entry stays</span>
    </div>
  );
}

function Candidate({
  book,
  target,
  onPick,
}: {
  book: BookDetail;
  target: BookDetail;
  onPick: () => void;
}) {
  // Primary author only: joining every creator surfaces calibre's producer credit as junk.
  const year = book.published && formatYear(book.published);
  const meta = [book.authors[0], year].filter(Boolean).join(" · ");
  // A shared series is the strongest "same book, other format" signal.
  const sameSeries =
    target.series !== null &&
    book.series?.name.toLowerCase() === target.series.name.toLowerCase();
  return (
    <li>
      <button
        type="button"
        className="mg-row"
        data-testid="merge-candidate"
        onClick={onPick}
      >
        <div className="mg-row-cover">
          <Cover book={book} src={book.hasCover ? coverUrl(book.uuid) : null} />
        </div>
        <div className="mg-row-main">
          <div className="mg-row-title">{book.title}</div>
          {meta && <div className="mg-row-meta mono">{meta}</div>}
        </div>
        <div className="mg-row-aside">
          {sameSeries && (
            <span className="mg-row-signal">
              <span className="mg-row-dot" />
              Same series
            </span>
          )}
          {book.formats.map((format) => (
            <span key={format} className="mg-fmt">
              {format}
            </span>
          ))}
        </div>
      </button>
    </li>
  );
}

type MergeDialogProps = {
  /** The book on the page: always the keeper, whose metadata wins. */
  target: BookDetail;
  onMerged: (mergeLogId: number) => void;
  onClose: () => void;
};

/** Find the other copy of a book, confirm, and fold it into this one. */
export function MergeDialog({ target, onMerged, onClose }: MergeDialogProps) {
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<BookDetail | null>(null);
  const settled = useDebounced(query).trim();
  const search = useQuery({
    queryKey: ["mergeCandidates", settled],
    queryFn: () => fetchMergeCandidates(settled),
    enabled: settled !== "",
    placeholderData: keepPreviousData,
  });
  const merge = useMutation({
    mutationFn: (from: BookDetail) => mergeBooksInto(from.uuid, target.uuid),
    onSuccess: (logId) => onMerged(logId),
  });
  const results =
    settled && !search.isError
      ? (search.data ?? [])
          .filter((b) => b.uuid !== target.uuid)
          .slice(0, MAX_RESULTS)
      : [];
  const error = merge.error ?? (search.isError ? search.error : null);
  return (
    // No dismissal while a merge runs: closing would hide the outcome.
    <ConfirmModal
      testId="merge-dialog"
      ariaLabel="Merge with another book"
      dialogClass="mg-modal"
      busy={merge.isPending}
      onDismiss={onClose}
      focusOnOpen
    >
      <div className="mg-head">
        <div className="label mg-kicker">Merge duplicate</div>
        <h2 className="mg-title">Merge with…</h2>
      </div>
      <div className="mg-body">
        {source ? (
          <div className="mg-confirm">
            <p className="mg-confirm-copy">
              <strong>“{source.title}”</strong> will be merged into{" "}
              <strong>“{target.title}”</strong>. Its files, tags, and reading
              progress move here; the other entry disappears. You can undo it
              until you leave this page.
            </p>
            <div className="mg-confirm-actions">
              <Button
                variant="primary"
                data-testid="merge-confirm"
                disabled={merge.isPending}
                aria-busy={merge.isPending}
                onClick={() => merge.mutate(source)}
              >
                <BusyLabel
                  busy={merge.isPending}
                  label="Merge"
                  busyLabel="Merging…"
                />
              </Button>
              <Button
                variant="ghost"
                data-testid="merge-back"
                disabled={merge.isPending}
                onClick={() => {
                  merge.reset();
                  setSource(null);
                }}
              >
                Back
              </Button>
            </div>
          </div>
        ) : (
          <>
            <p className="mg-intro">
              Find the other copy of this book. Its files, tags, highlights and
              reading progress move onto the entry you’re viewing — and the
              duplicate disappears.
            </p>
            <TargetRail target={target} />
            <div className="mg-search">
              <SearchGlyph size={18} className="mg-search-icon" />
              <input
                id="bd-merge-search"
                className="mg-search-input"
                data-testid="merge-search"
                aria-label="Search your library for a book to merge"
                type="search"
                // Merge search covers title, authors and series, not ISBN.
                placeholder="Search your library — title, author, series…"
                value={query}
                // biome-ignore lint/a11y/noAutofocus: the dialog exists to be typed into
                autoFocus
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            {results.length > 0 && (
              <>
                <div className="mg-results-head">
                  <span className="label">Results · {results.length}</span>
                  <span className="mono mg-results-hint">
                    matching title, author or series
                  </span>
                </div>
                <ul className="mg-results">
                  {results.map((book) => (
                    <Candidate
                      key={book.uuid}
                      book={book}
                      target={target}
                      onPick={() => setSource(book)}
                    />
                  ))}
                </ul>
              </>
            )}
          </>
        )}
        {error && (
          <p role="alert" className="bd-merge-error">
            {error.message}
          </p>
        )}
      </div>
      <div className="mg-foot">
        <span className="mono mg-foot-note">
          Nothing is deleted — undo is offered once, right after the merge.
        </span>
        <Button
          variant="ghost"
          size="sm"
          data-testid="merge-cancel"
          disabled={merge.isPending}
          onClick={onClose}
        >
          Cancel
        </Button>
      </div>
    </ConfirmModal>
  );
}
