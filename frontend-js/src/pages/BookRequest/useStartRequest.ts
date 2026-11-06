import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { type BookUuid, REQUEST_LISTS_KEY, startBookRequest } from "../../api";
import { useToast } from "../../components/Toast/Toast";
import { requestPath, startFailure } from "./requestView";

/** Starts an ebook request for the book and opens its request page, or says why it could not; with `stay`, the page stays where it is and only its lists are read again. */
export function useStartRequest(uuid: BookUuid, stay = false) {
  const navigate = useNavigate();
  const toast = useToast();
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => startBookRequest(uuid),
    onSuccess: (request) => {
      const refreshed = client.invalidateQueries({
        queryKey: REQUEST_LISTS_KEY,
      });
      if (stay) return refreshed;
      navigate(requestPath(uuid, request.id));
    },
    onError: (error) => toast(startFailure(error)),
  });
}
