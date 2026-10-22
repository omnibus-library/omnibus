import type { ReactNode } from "react";
import stoat from "../../assets/omnibus-stoat.png";

type EmptyNoteProps = {
  /** The heading's level: a whole tab's note is an h2, a column's an h3. */
  heading: "h2" | "h3";
  title: string;
  children: ReactNode;
  /** What the reader can do about it, as a button or a link. */
  action?: ReactNode;
  testId?: string;
};

/** The stoat's note for a section with nothing in it yet: what is missing, and what to do about it. */
export function EmptyNote({
  heading: Heading,
  title,
  children,
  action,
  testId,
}: EmptyNoteProps) {
  return (
    <div className="bp-empty" data-testid={testId}>
      <img src={stoat} alt="" width={56} height={56} />
      <div>
        <Heading>{title}</Heading>
        <p>{children}</p>
      </div>
      {action}
    </div>
  );
}
