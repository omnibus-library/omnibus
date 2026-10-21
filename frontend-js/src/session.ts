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

/** Re-reads the session user, so the menu, bylines and settings repaint with a write. */
export const refreshMe = (client: QueryClient) =>
  client.invalidateQueries({ queryKey: meQuery.queryKey });

/** Shows an accepted write on the session at once, so a reread that fails leaves the screens right. */
export const patchMe = (client: QueryClient, change: (user: User) => User) =>
  client.setQueryData(meQuery.queryKey, (user) => user && change(user));

// Bumped whenever a session starts or ends, so a write made under an earlier one can tell.
let generation = 0;

/** Which session is current; a write that recorded an earlier one must not be sent or cached. */
export const sessionGeneration = () => generation;

/** Makes `user` the session, dropping every answer and typed write cached for whoever came before. */
export function startSession(client: QueryClient, user: User) {
  generation += 1;
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
  generation += 1;
  navigate("/login", { replace: true });
  // A read still in flight would sign you back in.
  void client.cancelQueries({ queryKey: meQuery.queryKey });
  // Null, not cleared: the gate unmounts the signed-in screens before
  // anything under it can read a missing user.
  client.setQueryData(meQuery.queryKey, null);
  client.removeQueries({ predicate: (q) => q.queryKey[0] !== "me" });
  client.getMutationCache().clear();
}

/** How long a sign-out waits on `beforeLogout` before it goes ahead without it. */
const BEFORE_LOGOUT_MS = 2000;

/** Runs `beforeLogout` (for up to 2 s), then ends the session, drops every cached answer, and returns to /login. */
export function useSignOut(beforeLogout: () => Promise<void>) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    // What `beforeLogout` posts needs the cookie that `logout` revokes; a hung server must not hold the sign-out.
    mutationFn: async () => {
      await Promise.race([
        beforeLogout(),
        new Promise((resolve) => setTimeout(resolve, BEFORE_LOGOUT_MS)),
      ]);
      await logout();
    },
    onSuccess: () => endSession(queryClient, navigate),
  });
}

/** Saves a preference straight away, showing it on the session first; a refusal puts the session back. */
function useSavedPreference<V>(
  key: string,
  save: (value: V) => Promise<void>,
  apply: (user: User, value: V) => User,
) {
  const queryClient = useQueryClient();
  // The last save of any preference rereads the session, so none drops another's pending value.
  const lastSaving = () =>
    queryClient.isMutating({ mutationKey: ["preference"] }) <= 1;
  return useMutation({
    mutationKey: ["preference", key],
    mutationFn: save,
    onMutate: async (value) => {
      // A refetch already in flight would land over the optimistic value.
      await queryClient.cancelQueries({ queryKey: meQuery.queryKey });
      const previous = queryClient.getQueryData(meQuery.queryKey);
      patchMe(queryClient, (user) => apply(user, value));
      return { previous };
    },
    // With other saves pending, the snapshot is stale; the last one's reread corrects it.
    onError: (_error, _value, context) =>
      lastSaving() &&
      queryClient.setQueryData(meQuery.queryKey, context?.previous),
    onSettled: () =>
      lastSaving()
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

/** Saves the whole hidden-formats set; the boxes wait for the save, as the switches do. */
export function useHiddenFormats() {
  return useSavedPreference<string[]>(
    "hiddenFormats",
    setHiddenFormats,
    (user, formats) => ({ ...user, hiddenFormats: formats }),
  );
}
