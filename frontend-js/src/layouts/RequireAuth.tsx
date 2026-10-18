import { useQuery } from "@tanstack/react-query";
import { Navigate, Outlet, useLocation } from "react-router";
import { Loading } from "../components/Loading/Loading";
import { PageError } from "../components/PageState/PageState";
import { loginHref } from "../safeNext";
import { meQuery } from "../session";

/** Renders its routes once the session resolves, or sends a guest to /login. */
export function RequireAuth() {
  const me = useQuery(meQuery);
  const { pathname, search } = useLocation();
  switch (me.status) {
    case "pending":
      return <Loading kind="page" label="Opening your library" />;
    case "error":
      return (
        <PageError message={`Couldn't reach the server: ${me.error.message}`} />
      );
    case "success":
      return me.data ? (
        <Outlet />
      ) : (
        <Navigate to={loginHref(pathname + search)} replace />
      );
    default: {
      const _exhaustive: never = me;
      return _exhaustive;
    }
  }
}
