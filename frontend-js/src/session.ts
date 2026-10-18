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
      queryClient.clear();
      navigate("/login", { replace: true });
    },
  });
}
