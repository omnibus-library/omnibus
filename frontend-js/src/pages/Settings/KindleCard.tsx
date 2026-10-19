import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link } from "react-router";
import { z } from "zod";
import { kindleSenderQuery, setKindleEmail } from "../../api";
import { Button } from "../../components/Button/Button";
import { ConfirmDialog } from "../../components/ConfirmModal/ConfirmModal";
import { CopyButton } from "../../components/CopyButton/CopyButton";
import { BusyLabel, Loading } from "../../components/Loading/Loading";
import {
  External,
  refusal,
  type Status,
  StatusLine,
  useUnsavedGuard,
} from "../../components/SettingsShell/SettingsShell";
import { refreshMe, useCurrentUser } from "../../session";

const EmailSchema = z.object({
  email: z.string().trim().min(1, "Enter a Kindle email to save."),
});

const APPROVED_SENDERS = "https://www.amazon.com/sendtokindle/email";

/** Whether this server can deliver at all, and the sender to approve at Amazon. */
function DeliveryLine() {
  const { isAdmin } = useCurrentUser();
  const sender = useQuery(kindleSenderQuery);
  if (sender.isPending) {
    return (
      <Loading
        kind="section"
        className="start"
        testId="kindle-delivery-loading"
        label="Checking email delivery…"
      />
    );
  }
  // A failed read says nothing about whether delivery is set up.
  if (sender.isError) {
    return (
      <p className="subtitle" data-testid="kindle-delivery">
        Couldn’t check whether email delivery is set up on this server. Either
        way, add the library’s sender address to your Amazon{" "}
        <External href={APPROVED_SENDERS}>approved sender list</External> or
        Amazon drops the delivery.
      </p>
    );
  }
  if (sender.data) {
    return (
      <div className="kindle-delivery" data-testid="kindle-delivery">
        <p className="subtitle">
          Approve <code translate="no">{sender.data}</code> in your Amazon
          account’s{" "}
          <External href={APPROVED_SENDERS}>approved senders</External>, or
          Amazon drops the delivery.
        </p>
        <CopyButton
          text={sender.data}
          label="Copy address"
          testId="kindle-sender-copy"
          ariaLabel="Copy sender address"
        />
      </div>
    );
  }
  return (
    <p className="subtitle" data-testid="kindle-delivery">
      {isAdmin ? (
        <>
          Email delivery isn’t set up on this server yet.{" "}
          <Link to="/admin?section=integrations">Set up email delivery</Link>
        </>
      ) : (
        "Email delivery isn’t set up on this server. Ask your administrator."
      )}
    </p>
  );
}

/** The address Send to Kindle delivers to: saved, cleared, and whether this server can deliver. */
export function KindleCard() {
  const user = useCurrentUser();
  const queryClient = useQueryClient();
  const saved = user.kindleEmail ?? "";
  const [status, setStatus] = useState<Status | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const form = useForm({
    resolver: zodResolver(EmailSchema),
    defaultValues: { email: saved },
  });
  useUnsavedGuard("kindle-email", form.watch("email").trim() !== saved);

  const save = useMutation({
    mutationFn: async (email: string | null) => {
      await setKindleEmail(email);
      await refreshMe(queryClient);
      return email;
    },
    onMutate: () => setStatus(null),
    onSuccess: (email) => {
      if (email === null) form.setValue("email", "");
      setStatus({
        message: email ? "Kindle email saved." : "Kindle email cleared.",
        error: false,
      });
    },
    onError: (error) => setStatus(refusal(error)),
    onSettled: () => setConfirmClear(false),
  });

  return (
    <section className="card" data-testid="account-kindle-card">
      <h3>Kindle</h3>
      <p className="subtitle">
        The address Send to Kindle delivers your books to.
      </p>
      <form
        id="kindle-email-form"
        className="settings-form"
        onSubmit={form.handleSubmit(
          ({ email }) => save.mutate(email),
          (errors) =>
            setStatus({ message: errors.email?.message ?? "", error: true }),
        )}
      >
        <div className="settings-field">
          <label htmlFor="kindle-email">Kindle email</label>
          <input
            type="email"
            id="kindle-email"
            data-testid="kindle-email-input"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="you@kindle.com"
            {...form.register("email", { onChange: () => setStatus(null) })}
          />
        </div>
        <div className="settings-actions">
          {saved && (
            <Button
              variant="danger"
              className="settings-action-start"
              disabled={save.isPending}
              data-testid="kindle-email-clear"
              onClick={() => setConfirmClear(true)}
            >
              Clear
            </Button>
          )}
          <Button
            type="submit"
            variant="primary"
            disabled={save.isPending}
            aria-busy={save.isPending}
            data-testid="kindle-email-save"
          >
            <BusyLabel
              busy={save.isPending}
              label="Save Kindle email"
              busyLabel="Saving…"
            />
          </Button>
        </div>
      </form>
      <p
        className={saved ? "settings-status success" : "settings-status"}
        data-testid="kindle-email-connected"
      >
        {saved
          ? "A Kindle email is configured."
          : "No Kindle email configured yet."}
      </p>
      <DeliveryLine />
      <StatusLine testId="kindle-email-status" status={status} />
      {confirmClear && (
        <ConfirmDialog
          testId="kindle-email-clear-dialog"
          title="Clear your Kindle email?"
          body={`Send to Kindle stops delivering to ${saved} until you save an address again.`}
          action="Clear Kindle email"
          busyLabel="Clearing…"
          busy={save.isPending}
          onCancel={() => setConfirmClear(false)}
          onConfirm={() => save.mutate(null)}
        />
      )}
    </section>
  );
}
