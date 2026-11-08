import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import type { BookDetail, RequestKind } from "../../api";
import { Button, ButtonLink } from "../../components/Button/Button";
import { FormatSwitcher } from "../../components/FormatSwitcher/FormatSwitcher";
import { ImmersiveGlyph, PencilGlyph } from "../../components/Glyphs/Glyphs";
import { BusyLabel } from "../../components/Loading/Loading";
import { usePlayback } from "../../playback/PlaybackProvider";
import { useCurrentUser } from "../../session";
import {
  holdsAudiobook,
  holdsEbook,
  kindLabel,
} from "../BookRequest/requestView";
import { useStartRequest } from "../BookRequest/useStartRequest";
import type { BookDialog } from "./BookDialogs";
import { ExportMenu } from "./ExportMenu";
import { type DetailRow, detailRows } from "./identifiers";
import { PhysicalCopies, WishlistRow } from "./PhysicalCopies";
import { alignmentQuery } from "./queries";
import { SyncLine } from "./SyncLine";
import "./FilesDetails.css";

/** Merge for editors and admins, delete for admins; each opens the page's dialog. */
function CuratorActions({
  book,
  onOpenDialog,
}: {
  book: BookDetail;
  onOpenDialog: (dialog: BookDialog) => void;
}) {
  const viewer = useCurrentUser();
  // Merging folds this record's files into another book, so a record with none can't be offered it.
  const hasFiles = book.formats.length > 0;
  const mayMerge = (viewer.isAdmin || viewer.canEdit) && hasFiles;
  return (
    <>
      {mayMerge && (
        <Button
          size="sm"
          data-testid="merge-with"
          onClick={() => onOpenDialog("merge")}
        >
          Merge with…
        </Button>
      )}
      {/* Delete stays on a fileless record: its dialog is that record's only removal. */}
      {viewer.isAdmin && (
        <Button
          size="sm"
          className="bp-curator-delete"
          data-testid="delete-files"
          onClick={() => onOpenDialog("delete")}
        >
          {hasFiles ? "Delete files…" : "Delete record…"}
        </Button>
      )}
    </>
  );
}

const ADD_LABEL = {
  publisher: "Add publisher",
  published: "Add publication date",
  language: "Add language",
  isbn13: "Add ISBN",
} as const;

/** One row of the Details list; an unset field offers to open the editor on it. */
function Detail({ book, row }: { book: BookDetail; row: DetailRow }) {
  return (
    <div>
      <dt>{row.label}</dt>
      <dd>
        {"unset" in row ? (
          <>
            <span className="bp-unset">Not set</span>
            <Link
              className="bp-add"
              to={{
                pathname: `/books/${book.uuid}/edit`,
                search: `?field=${row.key}`,
              }}
              state={{ fromBook: true }}
              aria-label={ADD_LABEL[row.key]}
            >
              Add
            </Link>
          </>
        ) : (
          row.value
        )}
      </dd>
    </div>
  );
}

/** Each format's own place, linked or not: the lead sentence goes once the formats follow each other. */
function SyncRow({ book }: { book: BookDetail }) {
  const { link } = useQuery(alignmentQuery(book.uuid)).data ?? {};
  const linked = Boolean(link && !link.stale);
  const playback = usePlayback();
  return (
    <div className="bp-sync-row">
      {!linked && <p>Each format keeps its own place.</p>}
      <SyncLine uuid={book.uuid} />
      <ButtonLink
        variant="ghost"
        size="sm"
        to={`/read/${book.uuid}`}
        data-testid="sync-immersive"
        // Loads the audiobook, so the reader opens with it docked.
        onClick={(e) => {
          // A modified click opens the reader elsewhere, which loads its own audio.
          if (!(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey))
            playback.open(book.uuid, null);
        }}
      >
        <ImmersiveGlyph size={18} />
        Immersive
      </ButtonLink>
    </div>
  );
}

/** A format the library lacks, with a button to request it. */
function RequestSlot({ book, kind }: { book: BookDetail; kind: RequestKind }) {
  const start = useStartRequest(book.uuid);
  return (
    <div className="bp-slot" data-testid={`files-${kind}-slot`}>
      <span className="bp-slot-format">{kindLabel(kind)}</span>
      <span className="bp-slot-note">Not in the library</span>
      <Button
        size="sm"
        data-testid={`files-request-${kind}`}
        aria-disabled={start.isPending}
        aria-busy={start.isPending}
        onClick={() => {
          if (!start.isPending) start.mutate(kind);
        }}
      >
        <BusyLabel
          busy={start.isPending}
          label="Request"
          busyLabel="Requesting…"
        />
      </Button>
    </div>
  );
}

/** The book's files with what to do with them, the physical copies, its details, and the curator's actions. */
export function FilesDetails({
  book,
  onOpenDialog,
}: {
  book: BookDetail;
  onOpenDialog: (dialog: BookDialog) => void;
}) {
  const hasFiles = book.formats.length > 0;
  const mayRequest = useCurrentUser().canStartRequests;
  // Any ebook format counts as held, not only an EPUB.
  const canRequestEbook = mayRequest && !holdsEbook(book.formats);
  const canRequestAudiobook = mayRequest && !holdsAudiobook(book.formats);
  return (
    <div className="bp-files-tab">
      <div className="bp-file-column">
        {(hasFiles || canRequestEbook || canRequestAudiobook) && (
          <section aria-labelledby="bp-files-title">
            <div className="bp-section-head">
              <h2 id="bp-files-title">Files</h2>
            </div>
            <div className="bp-panel bp-files">
              {hasFiles && (
                <FormatSwitcher
                  uuid={book.uuid}
                  formats={book.formats}
                  files={book.bookFiles}
                  epubSizeBytes={book.epubSizeBytes}
                />
              )}
              {/* Every item sends or downloads a file; a comic-only record has none to offer. */}
              {(book.hasEbook || book.hasAudio || book.hasPdf) && (
                <ExportMenu book={book} />
              )}
              {book.hasEbook && book.hasAudio && <SyncRow book={book} />}
              {canRequestEbook && <RequestSlot book={book} kind="ebook" />}
              {canRequestAudiobook && (
                <RequestSlot book={book} kind="audiobook" />
              )}
            </div>
          </section>
        )}
        <section
          className="bp-panel bp-copies"
          aria-labelledby="bp-copies-title"
        >
          <h3 id="bp-copies-title" className="bp-panel-title">
            Physical copies
          </h3>
          <div className="rx-copies">
            <PhysicalCopies book={book} />
            <WishlistRow book={book} />
          </div>
        </section>
      </div>
      <section aria-labelledby="bp-details-title">
        <div className="bp-section-head">
          <h2 id="bp-details-title">Details</h2>
        </div>
        <dl className="bp-meta-list" data-testid="details-list">
          {detailRows(book).map((row) => (
            <Detail key={row.key} book={book} row={row} />
          ))}
        </dl>
        <div className="bp-curator">
          <ButtonLink
            size="sm"
            to={`/books/${book.uuid}/edit`}
            state={{ fromBook: true }}
            data-testid="edit-metadata"
          >
            <PencilGlyph size={16} />
            Edit metadata
          </ButtonLink>
          <CuratorActions book={book} onOpenDialog={onOpenDialog} />
        </div>
      </section>
    </div>
  );
}
