import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  type BookUuid,
  bookRequestQuery,
  cancelBookRequest,
  keepRequestCover,
  REQUEST_LISTS_KEY,
  type BookRequest as Request,
  swapRequestVersion,
  takeRequestCover,
  undoCancelBookRequest,
} from "../../api";
import { useToast } from "../../components/Toast/Toast";
import { nowSecs } from "../../format";
import { bookQuery } from "../BookDetail/queries";
import { undoToastMs } from "./requestView";

export const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : "Something went wrong.";

/** Replaces the cached request with the server's latest answer to a write, so polling follows the new state, and has the lists read again; returned, so a mutation stays pending until they are. */
export function useAnswer(id: number) {
  const client = useQueryClient();
  return (request: Request) => {
    client.setQueryData(bookRequestQuery(id).queryKey, request);
    return client.invalidateQueries({ queryKey: REQUEST_LISTS_KEY });
  };
}

/** Drops any poll in flight before a write, so a stale answer cannot flip the lane back. */
function useHoldPolls(id: number) {
  const client = useQueryClient();
  return () =>
    client.cancelQueries({ queryKey: bookRequestQuery(id).queryKey });
}

/** Reads the request and the lists again, as after a refusal that may mean the request moved on meanwhile. */
export function useReread(id: number) {
  const client = useQueryClient();
  return () =>
    Promise.all([
      client.invalidateQueries({ queryKey: bookRequestQuery(id).queryKey }),
      client.invalidateQueries({ queryKey: REQUEST_LISTS_KEY }),
    ]);
}

/** Cancel with an Undo toast for as long as the server will take it back; `refocus` runs once the cancel, or its Undo, is in and the button pressed is gone. */
export function useCancel(id: number, refocus: () => void) {
  const toast = useToast();
  const answer = useAnswer(id);
  const hold = useHoldPolls(id);
  const reread = useReread(id);
  const undo = useMutation({
    mutationFn: () => undoCancelBookRequest(id),
    onMutate: hold,
    onSuccess: (restored) => {
      refocus();
      return answer(restored);
    },
    onError: (error) => toast(`Couldn’t undo: ${messageOf(error)}`),
  });
  return useMutation({
    mutationFn: () => cancelBookRequest(id),
    onMutate: hold,
    onSuccess: (cancelled) => {
      refocus();
      const refreshed = answer(cancelled);
      if (cancelled.cancelAt === null) return refreshed;
      toast(
        "Request cancelled",
        { label: "Undo", onClick: () => undo.mutate() },
        undoToastMs(cancelled.cancelAt, nowSecs()),
      );
      return refreshed;
    },
    onError: (error) => {
      toast(`Couldn’t cancel: ${messageOf(error)}`);
      return reread();
    },
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
      onSwapped();
      return answer(swapped);
    },
    onError: (error) => toast(`Couldn’t choose another: ${messageOf(error)}`),
  });
}

/** Makes the downloaded cover the book's own; `onDone` runs once the offer is gone, when its card is. */
export function useTakeCover(id: number, uuid: BookUuid, onDone: () => void) {
  const toast = useToast();
  const client = useQueryClient();
  const answer = useAnswer(id);
  const hold = useHoldPolls(id);
  const reread = useReread(id);
  return useMutation({
    mutationFn: () => takeRequestCover(id, uuid),
    onMutate: hold,
    onSuccess: (taken) => {
      onDone();
      client.invalidateQueries({ queryKey: bookQuery(uuid).queryKey });
      return answer(taken);
    },
    onError: (error) => {
      toast(`Couldn’t use that cover: ${messageOf(error)}`);
      return reread();
    },
  });
}

/** Turns the downloaded cover down; `onDone` runs once the offer is gone, when its card is. */
export function useKeepCover(id: number, onDone: () => void) {
  const toast = useToast();
  const answer = useAnswer(id);
  const hold = useHoldPolls(id);
  const reread = useReread(id);
  return useMutation({
    mutationFn: () => keepRequestCover(id),
    onMutate: hold,
    onSuccess: (kept) => {
      onDone();
      return answer(kept);
    },
    onError: (error) => {
      toast(`Couldn’t keep this one: ${messageOf(error)}`);
      return reread();
    },
  });
}
