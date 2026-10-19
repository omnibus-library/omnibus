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
  inOrder,
  logout,
  setBookDetailScrollStops,
  setHiddenFormats,
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

/** Saves a preference straight away, showing it on the session first; a refusal puts the session back. */
function useSavedPreference<V>(
  key: string,
  save: (value: V) => Promise<void>,
  apply: (user: User, value: V) => User,
) {
  const queryClient = useQueryClient();
  const mutationKey = ["preference", key];
  return useMutation({
    mutationKey,
    mutationFn: save,
    onMutate: async (value) => {
      // A refetch already in flight would land over the optimistic value.
      await queryClient.cancelQueries({ queryKey: meQuery.queryKey });
      const previous = queryClient.getQueryData(meQuery.queryKey);
      queryClient.setQueryData(
        meQuery.queryKey,
        (user) => user && apply(user, value),
      );
      return { previous };
    },
    onError: (_error, _value, context) =>
      queryClient.setQueryData(meQuery.queryKey, context?.previous),
    // Only after the last save lands: an earlier read would drop the ones still queued.
    onSettled: () =>
      queryClient.isMutating({ mutationKey }) <= 1
        ? queryClient.invalidateQueries({ queryKey: meQuery.queryKey })
        : undefined,
  });
}

/** The preference switches `POST /api/account/*` saves, each as the session names it. */
export type UserSwitch = "stackSeries" | "bookDetailScrollStops" | "shareStats";

const SWITCH_SAVES = {
  stackSeries: setStackSeries,
  bookDetailScrollStops: setBookDetailScrollStops,
  shareStats: setShareStats,
} satisfies Record<UserSwitch, (enabled: boolean) => Promise<void>>;

/** Saves one switch straight away; a refusal puts it back. */
export function useUserSwitch(setting: UserSwitch) {
  return useSavedPreference(
    setting,
    SWITCH_SAVES[setting],
    (user, enabled) => ({
      ...user,
      [setting]: enabled,
    }),
  );
}

const hiddenFormatSaves = new Map<string, Promise<void>>();

/** Saves the whole hidden-formats set, one save at a time so a run of clicks lands in order. */
export function useHiddenFormats() {
  return useSavedPreference<string[]>(
    "hiddenFormats",
    (formats) =>
      inOrder(hiddenFormatSaves, "hiddenFormats", () =>
        setHiddenFormats(formats),
      ),
    (user, formats) => ({ ...user, hiddenFormats: formats }),
  );
}
