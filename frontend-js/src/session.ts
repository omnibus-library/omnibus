import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { fetchMe, logout, type User } from "./api";

export const meQuery = queryOptions({ queryKey: ["me"], queryFn: fetchMe });

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
