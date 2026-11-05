import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  bookRequestQuery,
  cancelBookRequest,
  type BookRequest as Request,
  swapRequestVersion,
  undoCancelBookRequest,
} from "../../api";
import { useToast } from "../../components/Toast/Toast";
import { nowSecs } from "../../format";
import { undoToastMs } from "./requestView";

export const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : "Something went wrong.";

/** Replaces the cached request with the server's latest answer to a write, so polling follows the new state. */
export function useAnswer(id: number) {
  const client = useQueryClient();
  return (request: Request) =>
    client.setQueryData(bookRequestQuery(id).queryKey, request);
}

/** Drops any poll in flight before a write, so a stale answer cannot flip the lane back. */
function useHoldPolls(id: number) {
  const client = useQueryClient();
  return () =>
    client.cancelQueries({ queryKey: bookRequestQuery(id).queryKey });
}

/** Cancel with an Undo toast for as long as the server will take it back; `onUndone` runs once Undo has put the request back. */
export function useCancel(id: number, onUndone: () => void) {
  const toast = useToast();
  const answer = useAnswer(id);
  const hold = useHoldPolls(id);
  const undo = useMutation({
    mutationFn: () => undoCancelBookRequest(id),
    onMutate: hold,
    onSuccess: (restored) => {
      answer(restored);
      onUndone();
    },
    onError: (error) => toast(`Couldn’t undo: ${messageOf(error)}`),
  });
  return useMutation({
    mutationFn: () => cancelBookRequest(id),
    onMutate: hold,
    onSuccess: (cancelled) => {
      answer(cancelled);
      if (cancelled.cancelAt === null) return;
      toast(
        "Request cancelled",
        { label: "Undo", onClick: () => undo.mutate() },
        undoToastMs(cancelled.cancelAt, nowSecs()),
      );
    },
    onError: (error) => toast(`Couldn’t cancel: ${messageOf(error)}`),
  });
}

/** Gives up the downloading version and goes back to choosing among the others; `onSwapped` runs once the new lane is in. */
export function useSwap(id: number, onSwapped: () => void) {
  const toast = useToast();
  const answer = useAnswer(id);
  const hold = useHoldPolls(id);
  return useMutation({
    mutationFn: () => swapRequestVersion(id),
    onMutate: hold,
    onSuccess: (swapped) => {
      answer(swapped);
      onSwapped();
    },
    onError: (error) => toast(`Couldn’t pick another: ${messageOf(error)}`),
  });
}
