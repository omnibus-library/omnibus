import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import {
  type BookUuid,
  type ExternalBookMeta,
  REQUEST_LISTS_KEY,
  startBookRequest,
  startRequestFromMeta,
} from "../../api";
import { useToast } from "../../components/Toast/Toast";
import { requestPath, startFailure } from "./requestView";

/** What a start is for: a library book, or a provider's record of one the library lacks. */
export type StartTarget = { uuid: BookUuid } | { meta: ExternalBookMeta };

/** Starts an ebook request, for the book the hook was given or the `target` that `mutate` names, and opens its request page, handing it `from` as router state, or says why it could not; with `stay`, the page stays where it is and only its lists are read again. */
export function useStartRequest(
  uuid: BookUuid | null,
  { stay = false, from }: { stay?: boolean; from?: unknown } = {},
) {
  const navigate = useNavigate();
  const toast = useToast();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (target?: StartTarget) => {
      if (target && "meta" in target) return startRequestFromMeta(target.meta);
      const book = target ? target.uuid : uuid;
      if (book === null) throw new Error("no book to request");
      return startBookRequest(book);
    },
    onSuccess: (request) => {
      const refreshed = client.invalidateQueries({
        queryKey: REQUEST_LISTS_KEY,
      });
      if (stay) return refreshed;
      navigate(requestPath(uuid ?? request.bookUuid, request.id), {
        state: from,
      });
    },
    onError: (error) => toast(startFailure(error)),
  });
}
