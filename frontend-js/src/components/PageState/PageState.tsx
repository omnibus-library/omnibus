import { ButtonLink } from "../Button/Button";

type BackLink = { backTo?: string; backLabel?: string };

/** A failed fetch: the message and a way back. */
export function PageError({
  message,
  backTo = "/",
  backLabel = "Back to library",
}: { message: string } & BackLink) {
  return (
    <>
      <p role="alert" className="subtitle">
        {message}
      </p>
      <ButtonLink to={backTo}>{backLabel}</ButtonLink>
    </>
  );
}

/** "`subject` not found." and a way back. */
export function PageNotFound({
  subject,
  backTo = "/",
  backLabel = "Back to library",
}: { subject: string } & BackLink) {
  return (
    <>
      <p className="subtitle">{subject} not found.</p>
      <ButtonLink to={backTo}>{backLabel}</ButtonLink>
    </>
  );
}
