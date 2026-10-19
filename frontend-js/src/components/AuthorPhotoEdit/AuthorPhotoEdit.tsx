import { useMutation } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import {
  type AuthorId,
  putAuthorPhotoUrl,
  scanAuthorPhoto,
  uploadAuthorPhoto,
} from "../../api";
import { Button } from "../Button/Button";
import { ConfirmModal } from "../ConfirmModal/ConfirmModal";
import { Ring } from "../Loading/Loading";
import "./AuthorPhotoEdit.css";

/** One way of changing the photo: what the status says while it runs, if it fails, and how it ended. */
type Edit = {
  working: string;
  failed: string;
  run: () => Promise<{ changed: boolean; message: string }>;
};

type PhotoModalProps = {
  authorId: AuthorId;
  authorName: string;
  onClose: () => void;
  onChange: () => void;
};

/** Three ways to change an author's photo, one request at a time: a pasted URL, an uploaded file, or a fresh scan of Open Library. */
function PhotoModal({
  authorId,
  authorName,
  onClose,
  onChange,
}: PhotoModalProps) {
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const edit = useMutation({
    mutationFn: (job: Edit) => job.run(),
    onMutate: (job) => setStatus(job.working),
    onSuccess: ({ changed, message }) => {
      setStatus(message);
      if (changed) onChange();
    },
    onError: (error, job) => setStatus(`${job.failed}: ${error.message}`),
  });
  const busy = edit.isPending;
  return (
    <ConfirmModal
      testId="author-photo-edit-modal"
      ariaLabel={`Edit photo for ${authorName}`}
      dialogClass="author-photo-modal"
      busy={false}
      onDismiss={onClose}
      focusOnOpen
    >
      <div className="author-photo-modal__head">
        <h2 className="author-photo-modal__title">Edit photo</h2>
      </div>

      <section className="author-photo-modal__section">
        <label className="label" htmlFor="author-photo-url">
          Paste image URL
        </label>
        <div className="author-photo-modal__url-row">
          <input
            id="author-photo-url"
            className="me-input"
            type="url"
            placeholder="https://example.com/photo.jpg"
            data-testid="author-photo-url-input"
            disabled={busy}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <Button
            disabled={busy || url.trim() === ""}
            data-testid="author-photo-url-submit"
            onClick={() =>
              edit.mutate({
                working: "Fetching…",
                failed: "URL failed",
                run: async () => {
                  await putAuthorPhotoUrl(authorId, url.trim());
                  return { changed: true, message: "Photo updated." };
                },
              })
            }
          >
            Use URL
          </Button>
        </div>
      </section>

      <section className="author-photo-modal__section">
        <label className="label" htmlFor="author-photo-file">
          Upload from this device
        </label>
        <input
          id="author-photo-file"
          className="author-photo-modal__file"
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          data-testid="author-photo-file-input"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            // Cleared so picking the same file again after a failure still fires.
            e.target.value = "";
            if (!file) return;
            edit.mutate({
              working: `Uploading ${file.name}…`,
              failed: "Upload failed",
              run: async () => {
                await uploadAuthorPhoto(authorId, file);
                return { changed: true, message: "Photo uploaded." };
              },
            });
          }}
        />
      </section>

      <section className="author-photo-modal__section">
        <p className="label">Or fetch automatically</p>
        <Button
          variant="ghost"
          disabled={busy}
          data-testid="author-photo-scan"
          onClick={() =>
            edit.mutate({
              working: "Scanning Open Library…",
              failed: "Scan failed",
              run: async () =>
                (await scanAuthorPhoto(authorId))
                  ? { changed: true, message: "Photo found." }
                  : {
                      changed: false,
                      message: "No photo on Open Library for this author.",
                    },
            })
          }
        >
          Scan for picture
        </Button>
      </section>

      {status && (
        <p
          className="author-photo-modal__status"
          role="status"
          data-testid="author-photo-status"
        >
          {busy && <Ring size="xs" className="author-photo-modal__ring" />}
          {status}
        </p>
      )}

      <div className="author-photo-modal__actions">
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
    </ConfirmModal>
  );
}

type AuthorPhotoEditProps = {
  authorId: AuthorId;
  authorName: string;
  /** Called after a URL, upload or scan changed the photo, so the page can refetch it. */
  onChange: () => void;
  children: ReactNode;
};

/** The author's portrait with a hover- and focus-revealed Edit button over it that opens the photo dialog. */
export function AuthorPhotoEdit({
  authorId,
  authorName,
  onChange,
  children,
}: AuthorPhotoEditProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className="author-photo-edit">
      {children}
      <button
        type="button"
        className="author-photo-edit__overlay"
        aria-label={`Edit photo for ${authorName}`}
        data-testid="author-photo-edit"
        onClick={() => setOpen(true)}
      >
        Edit
      </button>
      {open && (
        <PhotoModal
          authorId={authorId}
          authorName={authorName}
          onClose={() => setOpen(false)}
          onChange={() => {
            onChange();
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}
