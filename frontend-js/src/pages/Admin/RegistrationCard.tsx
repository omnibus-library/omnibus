import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { registrationStatusQuery, setRegistrationOpen } from "../../api";
import { Button } from "../../components/Button/Button";
import { registrationStatusLine } from "./users";

/** The switch for whether people can create their own accounts. */
export function RegistrationCard() {
  const queryClient = useQueryClient();
  const status = useQuery(registrationStatusQuery);
  const confirmed = status.data ?? null;
  const toggle = useMutation({
    mutationFn: setRegistrationOpen,
    onSuccess: async (_, enabled) => {
      await queryClient.cancelQueries({
        queryKey: registrationStatusQuery.queryKey,
      });
      queryClient.setQueryData(registrationStatusQuery.queryKey, enabled);
      // The sign-in and register pages read the same setting under their own key.
      void queryClient.invalidateQueries({ queryKey: ["registration"] });
    },
  });
  // While a save is out the switch shows what it asked for; the subtitle waits for the server.
  const shown = toggle.isPending ? toggle.variables : confirmed;
  const pending = confirmed === null && !status.isError;
  const error = toggle.error ?? status.error;

  return (
    <section className="card" data-testid="registration-card">
      <h3>Self-registration</h3>
      <p className="subtitle">Whether people can create their own accounts.</p>
      <div className="setting-row">
        <div className="setting-row-text">
          <label className="setting-row-label" htmlFor="registration-toggle">
            Allow new users to register
          </label>
          <p
            className={
              pending ? "setting-row-desc ld-sheen" : "setting-row-desc"
            }
            id="registration-toggle-desc"
          >
            {registrationStatusLine(confirmed)}
          </p>
        </div>
        <div className="setting-row-control">
          <span className="settings-switch">
            <input
              type="checkbox"
              role="switch"
              id="registration-toggle"
              aria-describedby="registration-toggle-desc"
              aria-checked={shown ?? undefined}
              // While unknown, the knob waits at centre rather than claim either policy.
              className={pending ? "ld-unknown" : "registration-check"}
              data-testid="registration-toggle"
              checked={shown === true}
              disabled={confirmed === null || toggle.isPending}
              onChange={(e) => toggle.mutate(e.target.checked)}
            />
          </span>
        </div>
      </div>
      {error && (
        <p
          role="alert"
          className="settings-status error"
          data-testid="registration-error"
        >
          {error.message}
        </p>
      )}
      {status.isError && confirmed === null && (
        <Button
          variant="ghost"
          size="sm"
          data-testid="registration-retry"
          onClick={() => status.refetch()}
        >
          Retry
        </Button>
      )}
    </section>
  );
}
