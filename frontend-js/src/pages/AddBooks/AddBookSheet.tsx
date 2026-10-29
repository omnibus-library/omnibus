import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type ChangeEvent, type ReactNode, useRef, useState } from "react";
import { useNavigate } from "react-router";
import {
  classifyPick,
  commitUpload,
  type Inspected,
  inspectUpload,
  type MetaForm,
  pickLabel,
  UPLOAD_ACCEPT,
  type UploadKind,
  uploadFailureMessage,
} from "../../api";
import { Button } from "../../components/Button/Button";
import { Cover } from "../../components/Cover/Cover";
import {
  BookGlyph,
  HeadphonesGlyph,
  UploadGlyph,
  XGlyph,
} from "../../components/Glyphs/Glyphs";
import { Sheet } from "../../components/Sheet/Sheet";
import type { StagedCover } from "../BookEdit/CoverEditor";
import { ReviewForm } from "./ReviewForm";
import "../BookDetail/BookPage.css";
import "../BookEdit/BookEdit.css";
import "../BookEdit/EditSheet.css";
import "./AddBooks.css";

/** What the chooser holds: nothing yet, a pick refused before sending, or a file being read or that couldn't be. */
type Chooser =
  | { kind: "empty" }
  | { kind: "refused"; reason: string }
  | { kind: "reading"; label: string }
  | { kind: "unreadable"; label: string; message: string };

type Added = { uuid: string; values: MetaForm; cover: string | null };

type Step =
  | { kind: "choose"; chooser: Chooser }
  | { kind: "review"; pick: Inspected; key: number }
  | { kind: "added"; book: Added };

const CHOOSE: Step = { kind: "choose", chooser: { kind: "empty" } };

const FORMATS = [
  { label: "Ebook", formats: "EPUB or PDF", audio: false },
  { label: "Audiobook", formats: "M4B, M4A or MP4", audio: true },
  {
    label: "Audiobook in parts",
    formats: "Every MP3 of one book, chosen together",
    audio: true,
  },
];

/** The compact steps' head: a title and Close. */
function StepHead({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <header className="es-head">
      <h2 className="es-title ab-title">{title}</h2>
      <button
        type="button"
        className="es-close"
        aria-label="Close"
        data-testid="es-close"
        onClick={onClose}
      >
        <XGlyph size={20} />
      </button>
    </header>
  );
}

/** The file input spread over the whole zone, so a drop or a click anywhere on it picks. */
function DropZone({ onPick }: { onPick: (files: File[]) => void }) {
  const [over, setOver] = useState(false);
  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    setOver(false);
    onPick([...(e.target.files ?? [])]);
    // So picking the same file again still counts as a change.
    e.target.value = "";
  };
  return (
    <div className={over ? "ab-drop is-over" : "ab-drop"}>
      <UploadGlyph />
      <p className="ab-drop-text">
        {over ? "Drop to upload" : "Drop a book here"}
      </p>
      <span className="btn ab-choose" aria-hidden="true" hidden={over}>
        Choose files
      </span>
      <input
        type="file"
        accept={UPLOAD_ACCEPT}
        multiple
        aria-label="Book files"
        className="ab-drop-input"
        onChange={onChange}
        onDragEnter={() => setOver(true)}
        onDragLeave={() => setOver(false)}
        onDrop={() => setOver(false)}
      />
    </div>
  );
}

/** The picked file in the zone's place: its progress while it is read, or why it couldn't be. */
function FileRow({
  chooser,
  progress,
  onChooseAnother,
}: {
  chooser: Extract<Chooser, { kind: "reading" | "unreadable" }>;
  progress: number;
  onChooseAnother: () => void;
}) {
  const reading = chooser.kind === "reading";
  return (
    <div className={reading ? "ab-file-row" : "ab-file-row is-failed"}>
      <span className="ab-file-glyph">
        <BookGlyph size={20} />
      </span>
      <div className="ab-file-text">
        <p className="ab-file-name" data-testid="add-book-file">
          {chooser.label}
        </p>
        {reading ? (
          <>
            <p className="ab-file-status" role="status">
              {`Reading the file · ${Math.round(progress * 100)}%`}
            </p>
            <progress
              className="ab-progress"
              aria-label="Upload progress"
              value={progress}
              max={1}
            />
          </>
        ) : (
          <p className="ab-file-status" role="alert">
            {chooser.message}
          </p>
        )}
      </div>
      {!reading && (
        <Button className="ab-choose" onClick={onChooseAnother}>
          Choose another file
        </Button>
      )}
    </div>
  );
}

/** What Omnibus takes, one row per kind of book. */
function Formats() {
  return (
    <dl className="ab-formats" data-testid="add-book-formats">
      {FORMATS.map(({ label, formats, audio }) => (
        <div key={label}>
          <dt>
            {audio ? <HeadphonesGlyph size={16} /> : <BookGlyph size={16} />}
            {label}
          </dt>
          <dd>{formats}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The chooser and the added book: a title, a body and a foot, hugging their content. */
function CompactStep({
  title,
  onClose,
  children,
  foot,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  foot: ReactNode;
}) {
  return (
    <div className="es-sheet ab-sheet">
      <StepHead title={title} onClose={onClose} />
      <div className="ab-body">{children}</div>
      <footer className="ab-foot">{foot}</footer>
    </div>
  );
}

const readFailed = (kind: UploadKind, error: unknown) =>
  `Couldn’t read that ${kind === "ebook" ? "EPUB" : "audiobook"}: ${uploadFailureMessage(error)}`;

/** Adding a book in one modal: pick a file, review it in the edit sheet, add it, then view it or add another. */
export function AddBookSheet({ onClosed }: { onClosed: () => void }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>(CHOOSE);
  const [progress, setProgress] = useState(0);
  const [closing, setClosing] = useState(false);
  // So a new pick remounts the review rather than carrying the last pick's edits into it.
  const picks = useRef(0);
  const close = () => setClosing(true);
  // The review routes Escape and the backdrop through its own question when it holds edits.
  const dismiss = useRef(close);

  const inspect = useMutation({
    mutationFn: ({ kind, files }: { kind: UploadKind; files: File[] }) =>
      inspectUpload(kind, files, setProgress),
    onMutate: ({ files }) => {
      setProgress(0);
      setStep({
        kind: "choose",
        chooser: { kind: "reading", label: pickLabel(files) },
      });
    },
    onSuccess: (pick) => {
      picks.current += 1;
      setStep({ kind: "review", pick, key: picks.current });
    },
    onError: (error, { kind, files }) =>
      setStep({
        kind: "choose",
        chooser: {
          kind: "unreadable",
          label: pickLabel(files),
          message: readFailed(kind, error),
        },
      }),
  });
  const add = useMutation({
    mutationFn: ({
      pick,
      values,
      cover,
    }: {
      pick: Inspected;
      values: MetaForm;
      cover: StagedCover;
    }) => commitUpload(pick, values, cover.source, setProgress),
    onMutate: () => setProgress(0),
    onSuccess: (uuid, { values, cover }) => {
      // The new book belongs on the library's lists the next time they are read.
      for (const queryKey of [["books"], ["shelves"], ["shelf-page"]]) {
        queryClient.invalidateQueries({ queryKey });
      }
      setStep({ kind: "added", book: { uuid, values, cover: cover.preview } });
    },
  });
  const busy = inspect.isPending || add.isPending;

  const onPick = (files: File[]) => {
    if (files.length === 0) return;
    const verdict = classifyPick(files.map((f) => f.name));
    if (verdict.ok) return inspect.mutate({ kind: verdict.kind, files });
    setStep({
      kind: "choose",
      chooser: { kind: "refused", reason: verdict.reason },
    });
  };
  const startOver = () => {
    add.reset();
    setStep(CHOOSE);
  };

  return (
    <Sheet
      label="Add a book"
      testId="add-book-sheet"
      compact={step.kind !== "review"}
      onDismiss={() => (step.kind === "review" ? dismiss.current() : close())}
      closing={closing}
      onClosed={onClosed}
      busy={busy}
    >
      {/* The sheet's buttons and fields are drawn in the book page's terms, which `bp-root` sets. */}
      <div className="bp-root ab-root">
        {step.kind === "choose" && (
          <CompactStep
            title="Add a book"
            onClose={close}
            foot={
              <p className="es-note">
                You’ll review the details before anything is added. Omnibus
                never writes to your book files.
              </p>
            }
          >
            {step.chooser.kind === "reading" ||
            step.chooser.kind === "unreadable" ? (
              <FileRow
                chooser={step.chooser}
                progress={progress}
                onChooseAnother={startOver}
              />
            ) : (
              <>
                <DropZone onPick={onPick} />
                {step.chooser.kind === "refused" && (
                  <p className="es-bar-problem" role="alert">
                    {step.chooser.reason}
                  </p>
                )}
              </>
            )}
            <Formats />
          </CompactStep>
        )}
        {step.kind === "review" && (
          <ReviewForm
            key={step.key}
            pick={step.pick}
            adding={add.isPending ? { progress } : null}
            error={
              add.error
                ? `Couldn’t add the book: ${uploadFailureMessage(add.error)}`
                : undefined
            }
            dismiss={dismiss}
            onAdd={(values, cover) =>
              add.mutate({ pick: step.pick, values, cover })
            }
            onChooseAnother={startOver}
            onClose={close}
          />
        )}
        {step.kind === "added" && (
          <CompactStep
            title="Added to your library"
            onClose={close}
            foot={
              <div className="ab-actions">
                <Button
                  onClick={() => {
                    close();
                    navigate(`/books/${step.book.uuid}`);
                  }}
                >
                  View book
                </Button>
                <Button variant="primary" onClick={startOver}>
                  Add another book
                </Button>
              </div>
            }
          >
            <AddedBook book={step.book} />
          </CompactStep>
        )}
      </div>
    </Sheet>
  );
}

function AddedBook({ book }: { book: Added }) {
  const { title, authors, series, seriesIndex } = book.values;
  const position =
    series && (seriesIndex ? `${series}, book ${seriesIndex}` : series);
  return (
    <div className="ab-added" data-testid="add-book-added">
      <div className="ab-added-cover">
        <Cover book={{ title, authors, accent: null }} src={book.cover} />
      </div>
      <div className="ab-added-text">
        <p className="ab-added-title">{title.trim()}</p>
        <p className="ab-added-author">{authors.join(", ")}</p>
        {position && <p className="ab-added-series">{position}</p>}
      </div>
    </div>
  );
}
