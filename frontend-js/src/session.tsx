import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Link, Navigate, NavLink, Outlet, useNavigate } from "react-router";
import brandMark from "../../frontend/assets/omnibus-stoat.png";
import { fetchMe, logout } from "./api";
import { BusyLabel, PageLoader } from "./atrium";

export const meQuery = queryOptions({ queryKey: ["me"], queryFn: fetchMe });

/** Renders the signed-in app around its routes, or sends a guest to /login. */
export function RequireAuth() {
  const me = useQuery(meQuery);
  switch (me.status) {
    case "pending":
      return <PageLoader label="Opening your library" />;
    case "error":
      return (
        <p className="library-empty" role="alert">
          Couldn't reach the server: {me.error.message}
        </p>
      );
    case "success":
      return me.data ? (
        <Shell userName={me.data.name} />
      ) : (
        <Navigate to="/login" replace />
      );
    default: {
      const _exhaustive: never = me;
      return _exhaustive;
    }
  }
}

function Shell({ userName }: { userName: string }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const signOut = useMutation({
    mutationFn: logout,
    onSuccess: () => {
      queryClient.clear();
      navigate("/login", { replace: true });
    },
  });

  return (
    <div className="app-shell">
      <nav className="atrium-topbar" aria-label="Primary">
        <Link to="/" className="atrium-brand">
          <img className="atrium-brand-mark" src={brandMark} alt="" />
          <div className="atrium-brand-word">Omnibus</div>
        </Link>
        <div className="atrium-nav">
          <NavLink
            to="/"
            end
            className={({ isActive }) => (isActive ? "on" : "")}
          >
            Library
          </NavLink>
        </div>
        <div className="atrium-actions">
          <span className="label">{userName}</span>
          <button
            type="button"
            className="btn sm"
            onClick={() => signOut.mutate()}
            disabled={signOut.isPending}
            aria-busy={signOut.isPending}
          >
            <BusyLabel
              busy={signOut.isPending}
              label="Sign out"
              busyLabel="Signing out…"
            />
          </button>
          {signOut.isError && (
            <span role="alert">Sign out failed: {signOut.error.message}</span>
          )}
        </div>
      </nav>
      <main>
        <Outlet />
      </main>
    </div>
  );
}
