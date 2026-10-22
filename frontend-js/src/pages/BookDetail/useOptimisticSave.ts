import {
  type QueryKey,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { useRef } from "react";
import { sessionGeneration } from "../../session";

/**
 * A save that shows its answer at once, then takes the server's. Only the newest write
 * settles the cache: an older one finishing late must not put its value back. A write is
 * bound to the session that made it: once another starts, one still queued is never sent,
 * and an answer that lands late touches no cache.
 */
export function useOptimisticSave<TData, TVars>(
  queryKey: QueryKey,
  mutationFn: (vars: TVars) => Promise<TData>,
  {
    optimistic,
    alsoInvalidate = [],
    onFailure,
  }: {
    optimistic: (vars: TVars) => TData;
    /** The other answers a save makes stale, or a function picking them for a save. */
    alsoInvalidate?: QueryKey[] | ((vars: TVars) => QueryKey[]);
    /** Told of every write the server refused, newest or not; `mutate`'s own callbacks hear only the last call. */
    onFailure?: (vars: TVars) => void;
  },
) {
  const client = useQueryClient();
  const newest = useRef(0);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  return useMutation({
    mutationKey: queryKey,
    // The server applies writes in arrival order, so an older write must not land after a newer one.
    mutationFn: (vars: TVars) => {
      const made = sessionGeneration();
      // Not under the next account's cookie.
      const dispatch = () => {
        if (made !== sessionGeneration()) {
          throw new Error("The session ended before this was saved.");
        }
        return mutationFn(vars);
      };
      const run = queue.current.then(dispatch, dispatch);
      queue.current = run.catch(() => {});
      return run;
    },
    onMutate: async (vars: TVars) => {
      const session = sessionGeneration();
      const id = ++newest.current;
      // Exact: reads under a longer key (the book's reviews, say) are not this write's to cancel.
      await client.cancelQueries({ queryKey, exact: true });
      const previous = client.getQueryData<TData>(queryKey) ?? null;
      client.setQueryData(queryKey, optimistic(vars));
      return { previous, id, session };
    },
    onError: (_error, vars, context) => {
      if (context?.session !== sessionGeneration()) return;
      onFailure?.(vars);
      if (context.id !== newest.current) return;
      client.setQueryData(queryKey, context.previous);
      // `previous` may itself have been an older write's guess.
      void client.invalidateQueries({ queryKey, exact: true });
    },
    onSuccess: (saved, vars, context) => {
      // The previous reader's answer has no place in this session's cache.
      if (context.session !== sessionGeneration()) return;
      // Whatever write is newest, one the server took has changed what it touches.
      const stale =
        typeof alsoInvalidate === "function"
          ? alsoInvalidate(vars)
          : alsoInvalidate;
      for (const key of stale) {
        void client.invalidateQueries({ queryKey: key });
      }
      if (context.id !== newest.current) return;
      client.setQueryData(queryKey, saved);
    },
    // The last write to settle refetches, so a failed newest one never leaves an older guess.
    // Exact, like the cancel: a refetch of a longer key could overwrite another save's guess.
    onSettled: (_data, _error, _vars, context) => {
      if (context?.session !== sessionGeneration()) return;
      if (client.isMutating({ mutationKey: queryKey, exact: true }) <= 1) {
        void client.invalidateQueries({ queryKey, exact: true });
      }
    },
  });
}
