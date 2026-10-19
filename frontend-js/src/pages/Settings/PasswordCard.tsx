import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { changePassword, sessionsQuery } from "../../api";
import { Button } from "../../components/Button/Button";
import { BusyLabel } from "../../components/Loading/Loading";
import {
  type Status,
  StatusLine,
} from "../../components/SettingsShell/SettingsShell";
import { StrengthMeter } from "../../components/StrengthMeter/StrengthMeter";
import { scorePassword } from "../../password";

const EMPTY = "Enter your current and new password.";

// The strength meter is advice; the server's rules are the authority.
const PasswordSchema = z.object({
  current: z.string().min(1, EMPTY),
  next: z.string().min(1, EMPTY),
});

const PASSWORD_ATTRS = {
  type: "password",
  autoCapitalize: "none",
  autoCorrect: "off",
  spellCheck: false,
} as const;

/** Change the password you sign in with: the current one authorizes, the server judges the new one. */
export function PasswordCard() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<Status | null>(null);
  const form = useForm({
    resolver: zodResolver(PasswordSchema),
    defaultValues: { current: "", next: "" },
  });
  const change = useMutation({
    mutationFn: ({ current, next }: z.output<typeof PasswordSchema>) =>
      changePassword(current, next),
    onMutate: () => setStatus(null),
    onSuccess: () => {
      // The server signed every other session out.
      void queryClient.invalidateQueries({ queryKey: sessionsQuery.queryKey });
      form.reset();
      setStatus({ message: "Password changed.", error: false });
    },
    onError: (error) => setStatus({ message: error.message, error: true }),
  });
  const clearStatus = { onChange: () => setStatus(null) };

  return (
    <section className="card" data-testid="account-password-card">
      <h3>Password</h3>
      <p className="subtitle">Change the password you use to sign in.</p>
      <form
        id="change-password-form"
        className="settings-form"
        onSubmit={form.handleSubmit(
          (values) => change.mutate(values),
          (errors) =>
            setStatus({
              message: (errors.current ?? errors.next)?.message ?? EMPTY,
              error: true,
            }),
        )}
      >
        <div className="settings-field">
          <label htmlFor="current-password">Current password</label>
          <input
            {...PASSWORD_ATTRS}
            id="current-password"
            data-testid="current-password-input"
            autoComplete="current-password"
            {...form.register("current", clearStatus)}
          />
        </div>
        <div className="settings-field">
          <label htmlFor="new-password">New password</label>
          <input
            {...PASSWORD_ATTRS}
            id="new-password"
            data-testid="new-password-input"
            autoComplete="new-password"
            {...form.register("next", clearStatus)}
          />
        </div>
        <StrengthMeter strength={scorePassword(form.watch("next"))} />
        <div className="settings-actions">
          <Button
            type="submit"
            variant="primary"
            disabled={change.isPending}
            aria-busy={change.isPending}
            data-testid="change-password-submit"
          >
            <BusyLabel
              busy={change.isPending}
              label="Change password"
              busyLabel="Changing…"
            />
          </Button>
        </div>
      </form>
      <StatusLine testId="change-password-status" status={status} />
    </section>
  );
}
