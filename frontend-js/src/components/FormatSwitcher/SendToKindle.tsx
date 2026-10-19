import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { type BookUuid, enqueueKindleSend, fetchKindleSend } from "../../api";
import { BusyLabel } from "../Loading/Loading";

/** Amazon's email gateway refuses a file over this many bytes. */
export const KINDLE_EMAIL_MAX_BYTES = 50_000_000;
/** The uploader that takes what email can't, up to 200 MB. */
export const KINDLE_WEB_UPLOAD_URL = "https://www.amazon.com/sendtokindle";

export const kindleOversize = (sizeBytes: number) =>
  sizeBytes > KINDLE_EMAIL_MAX_BYTES;

const POLL_MS = 700;
const SUCCESS_TOAST_MS = 4000;

type Outcome = { error: boolean; message: string };

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });

// Polls the queued send until it ends, or `signal` aborts (the button left the page).
async function outcomeOf(
  taskId: number,
  signal: AbortSignal,
): Promise<Outcome> {
  for (;;) {
    await sleep(POLL_MS, signal);
    const send = await fetchKindleSend(taskId, signal);
    switch (send.status) {
      case "pending":
        continue;
      case "sent":
        return { error: false, message: "Sent to your Kindle." };
      case "failed":
        return { error: true, message: `Send failed: ${send.message}` };
      case "unknown":
        return {
          error: true,
          message: "Send failed: could not confirm the send completed.",
        };
      default: {
        const _exhaustive: never = send;
        return _exhaustive;
      }
    }
  }
}

type SendToKindleProps = {
  uuid: BookUuid;
  /** One file of a multi-file book; none sends its EPUB, else its PDF. */
  fileId?: number;
  className?: string;
  testId?: string;
};

/** Queues the email, shows "Sending…" while it goes, then a toast: success clears itself, a failure stays. */
export function SendToKindle({
  uuid,
  fileId,
  className = "btn",
  testId = "action-kindle",
}: SendToKindleProps) {
  const [toast, setToast] = useState<Outcome | null>(null);
  const leaving = useRef(new AbortController());
  useEffect(() => {
    // Made here so a strict-mode remount gets a live one, not the aborted first.
    const controller = new AbortController();
    leaving.current = controller;
    return () => controller.abort();
  }, []);
  const send = useMutation({
    mutationFn: async () =>
      outcomeOf(
        await enqueueKindleSend(uuid, fileId ?? null),
        leaving.current.signal,
      ),
    onMutate: () => setToast(null),
    onSuccess: setToast,
    onError: (error) =>
      setToast({ error: true, message: `Send failed: ${error.message}` }),
  });
  useEffect(() => {
    if (!toast || toast.error) return;
    const timer = setTimeout(() => setToast(null), SUCCESS_TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast]);
  return (
    <>
      <button
        type="button"
        className={className}
        disabled={send.isPending}
        aria-busy={send.isPending}
        data-testid={testId}
        onClick={() => send.mutate()}
      >
        <BusyLabel
          busy={send.isPending}
          label="Send to Kindle"
          busyLabel="Sending…"
        />
      </button>
      {toast && (
        <div className="kindle-toast card" role="status">
          <span
            className={
              toast.error
                ? "kindle-toast-msg error"
                : "kindle-toast-msg success"
            }
            data-testid="kindle-send-status"
          >
            {toast.message}
          </span>
          <button
            type="button"
            className="btn ghost sm"
            aria-label="Dismiss"
            data-testid="kindle-toast-dismiss"
            onClick={() => setToast(null)}
          >
            ×
          </button>
        </div>
      )}
    </>
  );
}
