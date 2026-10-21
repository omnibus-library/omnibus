import { isRouteErrorResponse, useRouteError } from "react-router";
import { Button, ButtonLink } from "../Button/Button";
import { DiscPage } from "../DiscPage/DiscPage";
import { PageTitle } from "../PageTitle/PageTitle";
import "./RouteError.css";

type Described = { title: string; detail: string };

/** The heading and sentence a reader sees for whatever a route threw. */
export function describeRouteError(error: unknown): Described {
  if (isRouteErrorResponse(error)) {
    return {
      title: error.status === 404 ? "Page not found" : `Error ${error.status}`,
      detail: error.statusText || "This page couldn't load.",
    };
  }
  if (error instanceof Error) {
    return { title: "Something went wrong", detail: error.message };
  }
  return {
    title: "Something went wrong",
    detail: "Something unexpected stopped this page.",
  };
}

/** A route's error page: what happened, a retry, and a way back. */
export function RouteError() {
  const error = useRouteError();
  const { title, detail } = describeRouteError(error);
  return (
    <DiscPage>
      <PageTitle page={title} />
      <h1 className="disc-hero-title">{title}</h1>
      <p className="subtitle" role="alert">
        {detail}
      </p>
      <div className="route-error-actions">
        <Button variant="primary" onClick={() => window.location.reload()}>
          Try again
        </Button>
        <ButtonLink to="/">Back to library</ButtonLink>
      </div>
      {import.meta.env.DEV && error instanceof Error && error.stack && (
        <details className="route-error-stack">
          <summary className="label">Stack trace</summary>
          <pre>{error.stack}</pre>
        </details>
      )}
    </DiscPage>
  );
}
