import { Link } from "react-router";
import type { BookUuid } from "../../api";

type Props = {
  uuid: BookUuid;
  displayTitle: string;
  author: { name: string; id: number | null } | null;
};

/** Home › author › book › "Edit metadata". */
export function Breadcrumb({ uuid, displayTitle, author }: Props) {
  return (
    <nav className="bd-crumb me-crumb" aria-label="breadcrumb">
      <Link to="/" className="bd-crumb-home">
        Home
      </Link>
      <span className="bd-crumb-sep">›</span>
      {author && (
        <>
          {author.id === null ? (
            <span className="bd-crumb-step" data-testid="me-crumb-author">
              {author.name}
            </span>
          ) : (
            <Link
              to={`/authors/${author.id}`}
              className="bd-crumb-step"
              data-testid="me-crumb-author"
            >
              {author.name}
            </Link>
          )}
          <span className="bd-crumb-sep">›</span>
        </>
      )}
      <Link to={`/books/${uuid}`} className="bd-crumb-step">
        {displayTitle}
      </Link>
      <span className="bd-crumb-sep">›</span>
      <span className="bd-crumb-curr">Edit metadata</span>
    </nav>
  );
}

/** The kicker, the book and its author, and the hint under them. */
export function PageHeader({
  displayTitle,
  author,
}: {
  displayTitle: string;
  author: string | undefined;
}) {
  return (
    <div className="me-page-header">
      <div>
        <div className="label" data-testid="me-page-title-label">
          Edit metadata
        </div>
        <h2 className="me-page-title">
          <span className="me-page-title-book">{displayTitle}</span>
          {author && <span className="me-page-title-author">{author}</span>}
        </h2>
        <div className="mono me-page-hint">changes apply on save</div>
      </div>
    </div>
  );
}
