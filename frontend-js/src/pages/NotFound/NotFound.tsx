import { useLocation } from "react-router";
import { ButtonLink } from "../../components/Button/Button";
import { DiscPage } from "../../components/DiscPage/DiscPage";
import { PageTitle } from "../../components/PageTitle/PageTitle";

export function NotFound() {
  const { pathname } = useLocation();
  return (
    <DiscPage>
      <PageTitle page="Not found" />
      <h1 className="disc-hero-title">Page not found</h1>
      <p className="subtitle">Nothing lives at {pathname}.</p>
      <ButtonLink to="/">Back to library</ButtonLink>
    </DiscPage>
  );
}
