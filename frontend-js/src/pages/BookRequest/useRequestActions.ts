import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  bookRequestQuery,
  cancelBookRequest,
  type BookRequest as Request,
  swapRequestVersion,
  undoCancelBookRequest,
} from "../../api";
import { useToast } from "../../components/Toast/Toast";
import { UNDO_TOAST_MS } from "./requestView";

export const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : "Something went wrong.";

/** Replaces the cached request with the server's latest answer to a write, so polling follows the new state. */
export function useAnswer(id: number) {
  const client = useQueryClient();
  return (request: Request) =>
    client.setQueryData(bookRequestQuery(id).queryKey, request);
}

/** Cancel with an Undo toast for as long as the server will take it back. */
export function useCancel(id: number) {
  const toast = useToast();
  const answer = useAnswer(id);
  const undo = useMutation({
    mutationFn: () => undoCancelBookRequest(id),
    onSuccess: answer,
    onError: (error) => toast(`Couldn’t undo: ${messageOf(error)}`),
  });
  return useMutation({
    mutationFn: () => cancelBookRequest(id),
    onSuccess: (cancelled) => {
      answer(cancelled);
      toast(
        "Request cancelled",
        { label: "Undo", onClick: () => undo.mutate() },
        UNDO_TOAST_MS,
      );
    },
    onError: (error) => toast(`Couldn’t cancel: ${messageOf(error)}`),
  });
}

/** Gives up the downloading version and goes back to choosing among the others. */
export function useSwap(id: number) {
  const toast = useToast();
  return useMutation({
    mutationFn: () => swapRequestVersion(id),
    onSuccess: useAnswer(id),
    onError: (error) => toast(`Couldn’t pick another: ${messageOf(error)}`),
  });
}
