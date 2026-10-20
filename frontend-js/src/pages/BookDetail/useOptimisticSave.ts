import {
  type QueryKey,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { useRef } from "react";

/**
 * A save that shows its answer at once, then takes the server's. Only the newest write
 * settles the cache: an older one finishing late must not put its value back.
 */
export function useOptimisticSave<TData, TVars>(
  queryKey: QueryKey,
  mutationFn: (vars: TVars) => Promise<TData>,
  {
    optimistic,
    alsoInvalidate = [],
  }: {
    optimistic: (vars: TVars) => TData;
    /** The other answers a save makes stale, or a function picking them for a save. */
    alsoInvalidate?: QueryKey[] | ((vars: TVars) => QueryKey[]);
  },
) {
  const client = useQueryClient();
  const newest = useRef(0);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  return useMutation({
    mutationKey: queryKey,
    // The server applies writes in arrival order, so an older write must not land after a newer one.
    mutationFn: (vars: TVars) => {
      const run = queue.current.then(
        () => mutationFn(vars),
        () => mutationFn(vars),
      );
      queue.current = run.catch(() => {});
      return run;
    },
    onMutate: async (vars: TVars) => {
      const id = ++newest.current;
      await client.cancelQueries({ queryKey });
      const previous = client.getQueryData<TData>(queryKey) ?? null;
      client.setQueryData(queryKey, optimistic(vars));
      return { previous, id };
    },
    onError: (_error, _vars, context) => {
      if (context?.id !== newest.current) return;
      client.setQueryData(queryKey, context.previous);
      // `previous` may itself have been an older write's guess.
      void client.invalidateQueries({ queryKey });
    },
    onSuccess: (saved, vars, context) => {
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
    onSettled: () => {
      if (client.isMutating({ mutationKey: queryKey }) <= 1) {
        void client.invalidateQueries({ queryKey });
      }
    },
  });
}
