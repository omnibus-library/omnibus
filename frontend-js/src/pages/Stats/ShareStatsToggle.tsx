import { useCurrentUser, useShareStats } from "../../session";
import "../../styles/settings.css";

/** "Visible to your household": the sharing preference, offered where its effect is felt and saved straight away. */
export function ShareStatsToggle() {
  const user = useCurrentUser();
  const save = useShareStats();
  return (
    <div className="st-share">
      <label className="settings-switch st-share-switch">
        <input
          type="checkbox"
          role="switch"
          aria-checked={user.shareStats}
          data-testid="stats-share-toggle"
          checked={user.shareStats}
          disabled={save.isPending}
          onChange={(e) => save.mutate(e.target.checked)}
        />
        <span>Visible to your household</span>
      </label>
      {save.isError && (
        <span
          className="st-share-error"
          role="alert"
          data-testid="stats-share-error"
        >
          Couldn't change who can see your stats. Try again.
        </span>
      )}
    </div>
  );
}
