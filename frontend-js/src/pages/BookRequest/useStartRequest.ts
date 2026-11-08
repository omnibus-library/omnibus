import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { useLocation, useNavigate } from "react-router";
import {
  type BookUuid,
  bookRequestQuery,
  bookRequestsQuery,
  REQUEST_LISTS_KEY,
  type RequestKind,
  requestsQuery,
  startBookRequest,
} from "../../api";
import { useToast } from "../../components/Toast/Toast";
import { requestPath, startFailure } from "./requestView";

/** Starts a request of the kind `mutate` is given for the book, reads the Requests list again, then opens the book's request on the Requests page, handing it `from` as router state, unless the reader has moved on; with `stay`, the page stays where it is and the book's own list is read again too, before the mutation settles. `onStarted` runs as soon as the server has made the request. Says why on a refusal. */
export function useStartRequest(
  uuid: BookUuid,
  {
    stay = false,
    from,
    onStarted,
  }: { stay?: boolean; from?: unknown; onStarted?: () => void } = {},
) {
  const navigate = useNavigate();
  const toast = useToast();
  const client = useQueryClient();
  const { key } = useLocation();
  const here = useRef(key);
  here.current = key;
  return useMutation({
    mutationFn: (kind: RequestKind) => startBookRequest(uuid, kind),
    // The place the click happened, to tell whether the reader has left by the time it answers.
    onMutate: () => key,
    onSuccess: async (request, _vars, clickedAt) => {
      // The dossier reads this request next, so it opens with it rather than a loader.
      client.setQueryData(bookRequestQuery(request.id).queryKey, request);
      onStarted?.();
      // The list is what files the book under the new request; a failed read still opens the page.
      await client.refetchQueries({
        queryKey: requestsQuery.queryKey,
        type: "all",
      });
      // The page stays on screen, so its lanes must have the new request before it is clickable again.
      if (stay) {
        await client.refetchQueries({
          queryKey: bookRequestsQuery(uuid).queryKey,
        });
      }
      void client.invalidateQueries({ queryKey: REQUEST_LISTS_KEY });
      if (!stay && clickedAt === here.current) {
        navigate(requestPath(uuid), { state: from });
      }
    },
    onError: (error) => toast(startFailure(error)),
  });
}
