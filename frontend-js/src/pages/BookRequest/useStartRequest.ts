import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { useLocation, useNavigate } from "react-router";
import {
  type BookUuid,
  bookRequestQuery,
  REQUEST_LISTS_KEY,
  requestsQuery,
  startBookRequest,
} from "../../api";
import { useToast } from "../../components/Toast/Toast";
import { requestPath, startFailure } from "./requestView";

/** Starts an ebook request for the book, reads the Requests list again, then opens the book's request on the Requests page, handing it `from` as router state, unless the reader has moved on; with `stay`, the page stays where it is. Says why on a refusal. */
export function useStartRequest(
  uuid: BookUuid,
  { stay = false, from }: { stay?: boolean; from?: unknown } = {},
) {
  const navigate = useNavigate();
  const toast = useToast();
  const client = useQueryClient();
  const { key } = useLocation();
  const here = useRef(key);
  here.current = key;
  return useMutation({
    mutationFn: () => startBookRequest(uuid),
    // The place the click happened, to tell whether the reader has left by the time it answers.
    onMutate: () => key,
    onSuccess: async (request, _vars, clickedAt) => {
      // The dossier reads this request next, so it opens with it rather than a loader.
      client.setQueryData(bookRequestQuery(request.id).queryKey, request);
      // The list is what files the book under the new request; a failed read still opens the page.
      await client.refetchQueries({
        queryKey: requestsQuery.queryKey,
        type: "all",
      });
      void client.invalidateQueries({ queryKey: REQUEST_LISTS_KEY });
      if (!stay && clickedAt === here.current) {
        navigate(requestPath(uuid), { state: from });
      }
    },
    onError: (error) => toast(startFailure(error)),
  });
}
