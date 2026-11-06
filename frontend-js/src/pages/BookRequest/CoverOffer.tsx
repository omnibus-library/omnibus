import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId } from "react";
import {
  type Book,
  keepRequestCover,
  type BookRequest as Request,
  requestCoverUrl,
  takeRequestCover,
  thumbUrl,
} from "../../api";
import { Button } from "../../components/Button/Button";
import { Cover } from "../../components/Cover/Cover";
import { BusyLabel } from "../../components/Loading/Loading";
import { useToast } from "../../components/Toast/Toast";
import { PHONE_QUERY, useMediaQuery } from "../../useMediaQuery";
import { bookQuery } from "../BookDetail/queries";
import { coverSizesLine } from "./requestView";
import { messageOf, useAnswer } from "./useRequestActions";

/** A cover and its caption, as one labelled figure. */
function Figure({
  book,
  src,
  caption,
}: {
  book: Book;
  src: string;
  caption: string;
}) {
  const captionId = useId();
  return (
    <figure className="rq-offer-figure" aria-labelledby={captionId}>
      <div className="rq-offer-cover">
        <Cover book={book} src={src} />
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
  onDone,
}: {
  request: Request;
  offer: NonNullable<Request["coverOffer"]>;
  book: Book;
  onDone: () => void;
}) {
  const phone = useMediaQuery(PHONE_QUERY);
  const toast = useToast();
  const client = useQueryClient();
  const answer = useAnswer(request.id);
  const headingId = useId();
  const take = useMutation({
    mutationFn: () => takeRequestCover(request.id, request.bookUuid),
    onSuccess: (taken) => {
      onDone();
      client.invalidateQueries({
        queryKey: bookQuery(request.bookUuid).queryKey,
      });
      return answer(taken);
    },
    onError: (error) => toast(`Couldn’t use that cover: ${messageOf(error)}`),
  });
  const keep = useMutation({
    mutationFn: () => keepRequestCover(request.id),
    onSuccess: (kept) => {
      onDone();
      return answer(kept);
    },
    onError: (error) => toast(`Couldn’t keep this one: ${messageOf(error)}`),
  });
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
        <Figure book={book} src={thumbUrl(request.bookUuid)} caption="Now" />
        <Figure
          book={book}
          src={requestCoverUrl(request.id)}
          caption="From the download"
        />
      </div>
      <div className="rq-offer-text">
        <p id={headingId} className="rq-offer-heading">
          The download has a sharper cover
        </p>
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
