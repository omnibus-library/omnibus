import type { Book, BookRequest as Request } from "../../api";
import { nowSecs, recency } from "../../format";
import { PHONE_QUERY, useMediaQuery } from "../../useMediaQuery";
import { CoverOffer } from "./CoverOffer";
import { pickedMeta, pickedVersion, SEP, versionSize } from "./requestView";

/** The version that was added and when: its release name over its size, source and "added just now"; a phone heads it with its format and size and dims the name. */
function Added({ request }: { request: Request }) {
  const phone = useMediaQuery(PHONE_QUERY);
  const picked = pickedVersion(request);
  if (!picked) return null;
  const added = `added ${recency(nowSecs(), request.updatedAt)}`;
  const join = (parts: (string | null)[]) =>
    parts.filter((part) => part).join(SEP);
  return (
    <div className="rq-download" data-testid="request-chosen">
      <div className="rq-picked">
        {phone ? (
          <>
            <p className="rq-download-heading">
              {join([picked.format, versionSize(picked.sizeBytes)])}
            </p>
            <p className="rq-version-meta">{picked.title}</p>
            <p className="rq-version-meta">{join([picked.indexer, added])}</p>
          </>
        ) : (
          <>
            <p className="rq-version-name" title={picked.title}>
              {picked.title}
            </p>
            <p className="rq-version-meta">
              {join([pickedMeta(picked), added])}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

/** A ready request's lane: the version that was added, and the downloaded cover on offer to whoever may act on the request. */
export function Ready({
  request,
  canAct,
  book,
  onSettled,
}: {
  request: Request;
  canAct: boolean;
  book: Book;
  /** Runs once the offer is taken or kept, when its card is gone. */
  onSettled: () => void;
}) {
  return (
    <>
      <Added request={request} />
      {canAct && request.coverOffer && (
        <CoverOffer
          request={request}
          offer={request.coverOffer}
          book={book}
          onDone={onSettled}
        />
      )}
    </>
  );
}
