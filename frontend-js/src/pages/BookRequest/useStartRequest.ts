import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { type BookUuid, REQUEST_LISTS_KEY, startBookRequest } from "../../api";
import { useToast } from "../../components/Toast/Toast";
import { requestPath, startFailure } from "./requestView";

/** Starts an ebook request for the book, reads the request lists again, then opens the book's request on the Requests page, handing it `from` as router state; with `stay`, the page stays where it is. Says why on a refusal. */
export function useStartRequest(
  uuid: BookUuid,
  { stay = false, from }: { stay?: boolean; from?: unknown } = {},
) {
  const navigate = useNavigate();
  const toast = useToast();
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => startBookRequest(uuid),
    // Awaited even when it fails to read: the request exists, so the page opens regardless.
    onSuccess: async () => {
      await client.invalidateQueries({
        queryKey: REQUEST_LISTS_KEY,
        refetchType: "all",
      });
      if (!stay) navigate(requestPath(uuid), { state: from });
    },
    onError: (error) => toast(startFailure(error)),
  });
}
