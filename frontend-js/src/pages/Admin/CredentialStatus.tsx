import type { UseQueryResult } from "@tanstack/react-query";
import type { Status } from "../../components/SettingsShell/SettingsShell";

/** The line for a read that failed with nothing cached to show, else null. */
export function readFailure(
  query: Pick<
    UseQueryResult<unknown, Error>,
    "isError" | "isFetching" | "data" | "error"
  >,
  noun: "status" | "settings",
): Status | null {
  if (!query.isError || query.isFetching || query.data !== undefined) {
    return null;
  }
  return {
    message: `Couldn’t read the current ${noun}: ${query.error?.message}`,
    error: true,
  };
}

function CredentialDot({
  configured,
  readFailed,
  detail,
  unconfigured,
}: {
  configured: boolean | null;
  readFailed: boolean;
  detail: string;
  unconfigured: string;
}) {
  if (configured === true) {
    return (
      <>
        <span className="api-key-dot connected" />
        {detail}
      </>
    );
  }
  if (configured === false) {
    return (
      <>
        <span className="api-key-dot" />
        {unconfigured}
      </>
    );
  }
  if (readFailed) {
    return (
      <>
        <span className="api-key-dot" />
        Status unavailable
      </>
    );
  }
  return (
    <>
      <span className="api-key-dot pending" />
      <span className="ld-sheen">Checking…</span>
    </>
  );
}

/**
 * A credential's state as a dot and a line: `detail` once configured,
 * `unconfigured` when not. `configured` is null while the read is out, or after it failed.
 */
export function CredentialStatus({
  testId,
  ...state
}: {
  testId: string;
  configured: boolean | null;
  readFailed: boolean;
  detail: string;
  unconfigured: string;
}) {
  return (
    <div className="api-key-status mono" data-testid={testId}>
      <CredentialDot {...state} />
    </div>
  );
}
