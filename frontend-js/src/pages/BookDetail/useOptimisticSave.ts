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
  }: { optimistic: (vars: TVars) => TData; alsoInvalidate?: QueryKey[] },
) {
  const client = useQueryClient();
  const newest = useRef(0);
  return useMutation({
    mutationFn,
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
    onSuccess: (saved, _vars, context) => {
      if (context.id !== newest.current) return;
      client.setQueryData(queryKey, saved);
      for (const key of alsoInvalidate) {
        void client.invalidateQueries({ queryKey: key });
      }
    },
  });
}
