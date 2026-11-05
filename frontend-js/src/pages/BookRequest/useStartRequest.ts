import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { type BookUuid, startBookRequest } from "../../api";
import { useToast } from "../../components/Toast/Toast";
import { requestPath, startFailure } from "./requestView";

/** Starts an ebook request for the book and opens its request page, or says why it could not. */
export function useStartRequest(uuid: BookUuid) {
  const navigate = useNavigate();
  const toast = useToast();
  return useMutation({
    mutationFn: () => startBookRequest(uuid),
    onSuccess: (request) => navigate(requestPath(uuid, request.id)),
    onError: (error) => toast(startFailure(error)),
  });
}
