/** A card's result line. It stays mounted while empty, so its first message is announced. */
export function LiveStatus({
  testId,
  message,
  isError,
}: {
  testId: string;
  message: string | null;
  isError: boolean;
}) {
  let className = "settings-status";
  if (message !== null) {
    className = isError ? "settings-status error" : "settings-status success";
  }
  return (
    <p role="status" className={className} data-testid={testId}>
      {message}
    </p>
  );
}
