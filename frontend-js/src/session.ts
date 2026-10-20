import {
  type QueryClient,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useNavigate } from "react-router";
import {
  fetchMe,
  fetchRegistrationOpen,
  logout,
  setShareStats,
  setStackSeries,
  type User,
} from "./api";

export const meQuery = queryOptions({ queryKey: ["me"], queryFn: fetchMe });

/** Whether sign-up is open; a failed check reads as open, as the server's 403 is the real gate. */
export const registrationQuery = queryOptions({
  queryKey: ["registration"],
  queryFn: () => fetchRegistrationOpen().catch(() => true),
});

/** Makes `user` the session, dropping every answer cached for whoever came before. */
export function startSession(client: QueryClient, user: User) {
  client.removeQueries({ predicate: (q) => q.queryKey[0] !== "me" });
  client.setQueryData(meQuery.queryKey, user);
}

/** The signed-in user; only valid under `RequireAuth`, which resolves it first. */
export function useCurrentUser(): User {
  const { data } = useQuery(meQuery);
  if (!data) throw new Error("useCurrentUser rendered outside RequireAuth");
  return data;
}

/** Ends the session, drops every cached answer, and returns to /login. */
export function useSignOut() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: logout,
    onSuccess: () => {
      navigate("/login", { replace: true });
      // Null, not cleared: the gate unmounts the signed-in screens before
      // anything under it can read a missing user.
      queryClient.setQueryData(meQuery.queryKey, null);
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== "me" });
    },
  });
}

/** Saves an account switch straight away, patching the session's `key` optimistically; a refusal puts it back. */
function useAccountSwitch(
  save: (enabled: boolean) => Promise<void>,
  key: "stackSeries" | "shareStats",
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: save,
    onMutate: async (enabled) => {
      // A refetch already in flight would land over the optimistic value.
      await queryClient.cancelQueries({ queryKey: meQuery.queryKey });
      const previous = queryClient.getQueryData(meQuery.queryKey);
      queryClient.setQueryData(
        meQuery.queryKey,
        (user) => user && { ...user, [key]: enabled },
      );
      return { previous };
    },
    onError: (_error, _enabled, context) =>
      queryClient.setQueryData(meQuery.queryKey, context?.previous),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: meQuery.queryKey }),
  });
}

/** Saves the Stack series preference. */
export const useStackSeries = () =>
  useAccountSwitch(setStackSeries, "stackSeries");

/** Saves whether other readers can see the reader's stats. */
export const useShareStats = () =>
  useAccountSwitch(setShareStats, "shareStats");
