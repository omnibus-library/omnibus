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
  setStackSeries,
  type User,
} from "./api";

export const meQuery = queryOptions({ queryKey: ["me"], queryFn: fetchMe });

/** Whether sign-up is open; a failed check reads as open, as the server's 403 is the real gate. */
export const registrationQuery = queryOptions({
  queryKey: ["registration"],
  queryFn: () => fetchRegistrationOpen().catch(() => true),
});

/** Makes `user` the session, dropping every answer and typed write cached for whoever came before. */
export function startSession(client: QueryClient, user: User) {
  client.getMutationCache().clear();
  client.removeQueries({ predicate: (q) => q.queryKey[0] !== "me" });
  client.setQueryData(meQuery.queryKey, user);
}

/** The signed-in user; only valid under `RequireAuth`, which resolves it first. */
export function useCurrentUser(): User {
  const { data } = useQuery(meQuery);
  if (!data) throw new Error("useCurrentUser rendered outside RequireAuth");
  return data;
}

/** Leaves the session: to /login, with every cached answer and typed write dropped. */
export function endSession(
  client: QueryClient,
  navigate: (to: string, options: { replace: true }) => void,
) {
  navigate("/login", { replace: true });
  // A read still in flight would sign you back in.
  void client.cancelQueries({ queryKey: meQuery.queryKey });
  // Null, not cleared: the gate unmounts the signed-in screens before
  // anything under it can read a missing user.
  client.setQueryData(meQuery.queryKey, null);
  client.removeQueries({ predicate: (q) => q.queryKey[0] !== "me" });
  client.getMutationCache().clear();
}

/** Ends the session, drops every cached answer, and returns to /login. */
export function useSignOut() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: logout,
    onSuccess: () => endSession(queryClient, navigate),
  });
}

/** Saves the Stack series preference straight away; a refusal puts the switch back. */
export function useStackSeries() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: setStackSeries,
    onMutate: async (enabled) => {
      // A refetch already in flight would land over the optimistic value.
      await queryClient.cancelQueries({ queryKey: meQuery.queryKey });
      const previous = queryClient.getQueryData(meQuery.queryKey);
      queryClient.setQueryData(
        meQuery.queryKey,
        (user) => user && { ...user, stackSeries: enabled },
      );
      return { previous };
    },
    onError: (_error, _enabled, context) =>
      queryClient.setQueryData(meQuery.queryKey, context?.previous),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: meQuery.queryKey }),
  });
}
