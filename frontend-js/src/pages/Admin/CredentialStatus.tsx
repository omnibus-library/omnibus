import type { CredentialState } from "./integrations";

function CredentialDot({
  state,
  detail,
  unconfigured,
}: {
  state: CredentialState;
  detail: string;
  unconfigured: string;
}) {
  switch (state) {
    case "configured":
      return (
        <>
          <span className="api-key-dot connected" />
          {detail}
        </>
      );
    case "unconfigured":
      return (
        <>
          <span className="api-key-dot" />
          {unconfigured}
        </>
      );
    case "unavailable":
      return (
        <>
          <span className="api-key-dot" />
          Status unavailable
        </>
      );
    case "checking":
      return (
        <>
          <span className="api-key-dot pending" />
          <span className="ld-sheen">Checking…</span>
        </>
      );
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}

/** A credential's state as a dot and a line: `detail` once configured, `unconfigured` when not. */
export function CredentialStatus({
  testId,
  state,
  detail,
  unconfigured,
}: {
  testId: string;
  state: CredentialState;
  detail: string;
  unconfigured: string;
}) {
  return (
    <div className="api-key-status mono" data-testid={testId}>
      <CredentialDot
        state={state}
        detail={detail}
        unconfigured={unconfigured}
      />
    </div>
  );
}
