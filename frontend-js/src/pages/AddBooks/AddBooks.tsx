import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type ChangeEvent, useRef, useState } from "react";
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
import { Ring } from "../../components/Loading/Loading";
import { PageTitle } from "../../components/PageTitle/PageTitle";
import { useCurrentUser } from "../../session";
import type { StagedCover } from "../BookEdit/CoverEditor";
import { ReviewForm } from "./ReviewForm";
import "../../styles/settings.css";
import "../BookDetail/BookDetail.css";
import "../BookEdit/BookEdit.css";
import "./AddBooks.css";

type Status = { text: string; tone: "working" | "error" | "success" };

/** The pick's status line: a ring and the upload's progress while a file goes up, then the outcome. */
function UploadStatus({
  status,
  progress,
}: {
  status: Status;
  progress: number;
}) {
  const working = status.tone === "working";
  return (
    <p
      id="add-books-status"
      data-testid="add-books-status"
      role="status"
      aria-busy={working}
      className={`settings-status ${working ? "is-working" : status.tone}`}
    >
      {working && <Ring size="xs" />}
      {status.text}
      {working && ` ${Math.round(progress * 100)}%`}
      {working && (
        <progress
          className="add-books-progress"
          aria-label="Upload progress"
          value={progress}
          max={1}
        />
      )}
    </p>
  );
}

/** The picker for every format: a single EPUB, an audiobook container, or an audiobook's MP3 parts. */
function FileDropZone({
  label,
  disabled,
  onPick,
}: {
  label: string | null;
  disabled: boolean;
  onPick: (files: File[]) => void;
}) {
  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    onPick([...(e.target.files ?? [])]);
    // So picking the same file again still counts as a change.
    e.target.value = "";
  };
  return (
    <div className="settings-field">
      <div className={label ? "file-drop-zone has-file" : "file-drop-zone"}>
        <div className="file-drop-content">
          {label ? (
            <>
              <svg
                className="file-drop-icon file-drop-icon--ok"
                width="28"
                height="28"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <span className="file-drop-filename">{label}</span>
              <span className="file-drop-change">Click to change</span>
            </>
          ) : (
            <>
              <svg
                className="file-drop-icon"
                width="28"
                height="28"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              <span className="file-drop-prompt">
                Drop an EPUB or audiobook here or <strong>choose a file</strong>
              </span>
            </>
          )}
        </div>
        <input
          id="add-books-file"
          type="file"
          accept={UPLOAD_ACCEPT}
          multiple
          data-testid="add-books-file-input"
          aria-label="Book files"
          className="file-drop-input"
          disabled={disabled}
          onChange={onChange}
        />
      </div>
      <p className="settings-hint" data-testid="add-books-formats">
        EPUB, PDF, M4B, M4A, MP4, or the MP3 parts of one audiobook.
      </p>
    </div>
  );
}

const uploadFailed = (error: unknown) =>
  `Upload failed: ${uploadFailureMessage(error)}`;

function AddBooksForm() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [review, setReview] = useState<{ pick: Inspected; key: number } | null>(
    null,
  );
  const [status, setStatus] = useState<Status | null>(null);
  const [progress, setProgress] = useState(0);
  // So a new pick remounts the review rather than carrying the last pick's edits into it.
  const picks = useRef(0);

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
    onMutate: () => {
      setProgress(0);
      setStatus({ text: "Adding to your library…", tone: "working" });
    },
    onSuccess: () => {
      // The new book belongs on the library's lists the next time they are read.
      for (const queryKey of [["books"], ["shelves"], ["shelf-page"]]) {
        queryClient.invalidateQueries({ queryKey });
      }
    },
    onError: (error) => setStatus({ text: uploadFailed(error), tone: "error" }),
  });
  const inspect = useMutation({
    mutationFn: ({ kind, files }: { kind: UploadKind; files: File[] }) =>
      inspectUpload(kind, files, setProgress),
    onMutate: ({ files }) => {
      add.reset();
      setReview(null);
      setProgress(0);
      setStatus({ text: `Uploading ${pickLabel(files)}…`, tone: "working" });
    },
    onSuccess: (pick) => {
      picks.current += 1;
      setReview({ pick, key: picks.current });
      setStatus({
        text: "Review the details, then add it to your library.",
        tone: "success",
      });
    },
    onError: (error, { kind }) =>
      setStatus({
        text: `Could not read that ${kind === "ebook" ? "EPUB" : "audiobook"}: ${uploadFailureMessage(error)}`,
        tone: "error",
      }),
  });
  const busy = inspect.isPending || add.isPending;

  const onPick = (files: File[]) => {
    if (files.length === 0) return;
    const verdict = classifyPick(files.map((f) => f.name));
    if (verdict.ok) return inspect.mutate({ kind: verdict.kind, files });
    setReview(null);
    setStatus({ text: verdict.reason, tone: "error" });
  };

  return (
    <>
      <section className="card">
        <h1>Upload a book</h1>
        <FileDropZone
          label={review?.pick.label ?? null}
          disabled={busy}
          onPick={onPick}
        />
        {status && <UploadStatus status={status} progress={progress} />}
      </section>
      {review && (
        <ReviewForm
          key={review.key}
          pick={review.pick}
          saving={add.isPending}
          error={add.error ? uploadFailed(add.error) : undefined}
          onAdd={(values, cover) =>
            // Per call, so an answer that lands after the page was left doesn't navigate.
            add.mutate(
              { pick: review.pick, values, cover },
              { onSuccess: (uuid) => navigate(`/books/${uuid}`) },
            )
          }
          onStartOver={() => {
            add.reset();
            setReview(null);
            setStatus(null);
          }}
        />
      )}
    </>
  );
}

/** Upload page: pick a file, review the whole record, add it. */
export function AddBooks() {
  const { canUpload } = useCurrentUser();
  return (
    <>
      <PageTitle page="Add books" />
      {canUpload ? (
        <AddBooksForm />
      ) : (
        <section className="card">
          <h1>Upload a book</h1>
          <p
            className="settings-status error"
            data-testid="add-books-forbidden"
          >
            You don't have permission to add books to this library.
          </p>
        </section>
      )}
    </>
  );
}
