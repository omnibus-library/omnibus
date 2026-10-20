import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import {
  ebookConvertQuery,
  replaceQueryData,
  saveEbookConvert,
} from "../../api";
import { Button } from "../../components/Button/Button";
import { BusyLabel } from "../../components/Loading/Loading";
import {
  type Status,
  StatusLine,
  useUnsavedGuard,
} from "../../components/SettingsShell/SettingsShell";
import { CredentialStatus, readFailure } from "./CredentialStatus";
import {
  ebookConvertDetail,
  ebookConvertPlaceholder,
  isOverridden,
  saveOutcomeMessage,
} from "./integrations";

/** The Calibre `ebook-convert` the server found, with a field to pin its path instead. */
export function EbookConvertCard() {
  const queryClient = useQueryClient();
  const current = useQuery(ebookConvertQuery);
  const [typed, setTyped] = useState("");
  const [status, setStatus] = useState<Status | null>(null);
  useUnsavedGuard("ebook-convert", typed.trim() !== "");

  const write = useMutation({
    mutationFn: saveEbookConvert,
    onSuccess: (answer) =>
      replaceQueryData(queryClient, ebookConvertQuery.queryKey, answer),
  });

  // The clear button shares the mutation, with a null path.
  const saving = write.isPending && write.variables !== null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const path = typed.trim();
    // Going back to auto-detection is the "Use auto-detection" button's job.
    if (path === "") {
      setStatus({
        message: "Enter a path to ebook-convert to save.",
        error: true,
      });
      return;
    }
    setStatus(null);
    write.mutate(path, {
      onSuccess: (answer) => {
        setTyped("");
        setStatus(saveOutcomeMessage(answer.available));
      },
      onError: (error) =>
        setStatus({
          message: `Couldn’t save the ebook-convert path: ${error.message}`,
          error: true,
        }),
    });
  };

  const useAutoDetection = () =>
    write.mutate(null, {
      onSuccess: () => {
        setTyped("");
        setStatus({
          message: "Override cleared — using auto-detection.",
          error: false,
        });
      },
      onError: (error) =>
        setStatus({
          message: `Couldn’t clear the ebook-convert path: ${error.message}`,
          error: true,
        }),
    });

  const failedRead = readFailure(current, "status");
  const readFailed = failedRead !== null;
  const shown = status ?? failedRead;

  return (
    <section className="card" data-testid="ebook-convert-card">
      <h3>Calibre format conversion</h3>
      <p className="subtitle">
        Omnibus converts between ebook formats with Calibre’s ebook-convert.
        Calibre is optional — without it, conversion stays disabled and
        everything else works as usual.
      </p>
      <form className="settings-form" onSubmit={submit}>
        <div className="settings-field">
          <label htmlFor="ebook-convert-path" translate="no">
            ebook-convert path
          </label>
          <input
            type="text"
            id="ebook-convert-path"
            name="ebook_convert_path"
            autoComplete="off"
            translate="no"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder={ebookConvertPlaceholder(current.data)}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
          />
        </div>
        <div className="settings-actions">
          <CredentialStatus
            testId="ebook-convert-status"
            configured={current.data?.available ?? null}
            readFailed={readFailed}
            detail={ebookConvertDetail(current.data)}
            unconfigured="Not detected"
          />
          {isOverridden(current.data) && (
            <Button
              variant="ghost"
              disabled={write.isPending}
              data-testid="ebook-convert-clear"
              onClick={useAutoDetection}
            >
              Use auto-detection
            </Button>
          )}
          <Button
            type="submit"
            variant="primary"
            disabled={write.isPending}
            aria-busy={saving}
            data-testid="ebook-convert-save"
          >
            <BusyLabel
              busy={saving}
              label="Save ebook-convert path"
              busyLabel="Saving…"
            />
          </Button>
        </div>
        <StatusLine testId="ebook-convert-save-status" status={shown} />
      </form>
    </section>
  );
}
