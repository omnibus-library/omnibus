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
