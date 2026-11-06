import { useId } from "react";
import {
  type Book,
  type BookRequest as Request,
  requestCoverUrl,
  thumbUrl,
} from "../../api";
import { Button } from "../../components/Button/Button";
import { Cover } from "../../components/Cover/Cover";
import { BusyLabel } from "../../components/Loading/Loading";
import { PHONE_QUERY, useMediaQuery } from "../../useMediaQuery";
import type { DossierVariant } from "./RequestHistory";
import { coverSizesLine } from "./requestView";
import { useKeepCover, useReread, useTakeCover } from "./useRequestActions";

/** A cover and its caption, as one labelled figure; `onError` runs when the image cannot load. */
function Figure({
  book,
  src,
  alt,
  caption,
  onError,
}: {
  book: Book;
  src: string;
  alt: string;
  caption: string;
  onError?: () => void;
}) {
  const captionId = useId();
  return (
    <figure className="rq-offer-figure" aria-labelledby={captionId}>
      <div className="rq-offer-cover">
        <Cover book={book} src={src} alt={alt} onError={onError} />
      </div>
      <figcaption id={captionId}>{caption}</figcaption>
    </figure>
  );
}

/** The cover a finished download brought beside the book's own, with Use and Keep; either settles the offer for good, and `onDone` runs once it has, when this card is gone. */
export function CoverOffer({
  request,
  offer,
  book,
  variant,
  onDone,
}: {
  request: Request;
  offer: NonNullable<Request["coverOffer"]>;
  book: Book;
  variant: DossierVariant;
  onDone: () => void;
}) {
  const phone = useMediaQuery(PHONE_QUERY);
  const take = useTakeCover(request.id, request.bookUuid, onDone);
  const keep = useKeepCover(request.id, onDone);
  // A download cover that cannot be fetched means the offer is gone, so the request says so.
  const reread = useReread(request.id);
  const headingId = useId();
  // One level under the lane's own title.
  const Heading = variant === "pane" ? "h4" : "h3";
  const busy = take.isPending || keep.isPending;
  const size = phone ? "md" : "sm";
  // aria-disabled, not disabled: a control that disables itself drops the keyboard's focus.
  const keepButton = (
    <Button
      variant="ghost"
      size={size}
      data-testid="request-cover-keep"
      aria-busy={keep.isPending}
      aria-disabled={busy}
      onClick={() => {
        if (!busy) keep.mutate();
      }}
    >
      <BusyLabel
        busy={keep.isPending}
        label="Keep this one"
        busyLabel="Keeping…"
      />
    </Button>
  );
  const takeButton = (
    <Button
      variant="primary"
      size={size}
      data-testid="request-cover-take"
      aria-busy={take.isPending}
      aria-disabled={busy}
      onClick={() => {
        if (!busy) take.mutate();
      }}
    >
      <BusyLabel
        busy={take.isPending}
        label="Use the downloaded cover"
        busyLabel="Using…"
      />
    </Button>
  );
  return (
    <section
      className="rq-download rq-cover-offer"
      aria-labelledby={headingId}
      data-testid="request-cover-offer"
    >
      <div className="rq-offer-covers">
        <Figure
          book={book}
          src={thumbUrl(request.bookUuid)}
          alt="Current cover"
          caption="Now"
        />
        {/* shortcut: the full-size download fetched for a 64px figure; upgrade when candidates go through the thumbs pipeline. */}
        <Figure
          book={book}
          src={requestCoverUrl(request.id)}
          alt="Cover from the download"
          caption="From the download"
          onError={() => void reread()}
        />
      </div>
      <div className="rq-offer-text">
        <Heading id={headingId} className="rq-offer-heading">
          The download has a sharper cover
        </Heading>
        <p className="rq-version-meta" data-testid="request-cover-sizes">
          {coverSizesLine(offer)}
        </p>
      </div>
      <div className="rq-offer-actions">
        {phone ? (
          <>
            {takeButton}
            {keepButton}
          </>
        ) : (
          <>
            {keepButton}
            {takeButton}
          </>
        )}
      </div>
    </section>
  );
}
