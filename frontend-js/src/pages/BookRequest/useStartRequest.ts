import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { type BookUuid, REQUEST_LISTS_KEY, startBookRequest } from "../../api";
import { useToast } from "../../components/Toast/Toast";
import { requestPath, startFailure } from "./requestView";

/** Starts an ebook request for the book and opens its request page, or says why it could not. */
export function useStartRequest(uuid: BookUuid) {
  const navigate = useNavigate();
  const toast = useToast();
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => startBookRequest(uuid),
    onSuccess: (request) => {
      client.invalidateQueries({ queryKey: REQUEST_LISTS_KEY });
      navigate(requestPath(uuid, request.id));
    },
    onError: (error) => toast(startFailure(error)),
  });
}
