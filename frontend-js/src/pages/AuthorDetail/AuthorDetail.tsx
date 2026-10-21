import { useParams } from "react-router";
import { parseAuthorId } from "../../api";
import { PageNotFound } from "../../components/PageState/PageState";
import { AuthorPane } from "./AuthorPane";

/** `/authors/:id`'s pane, inside the authors list's layout. */
export function AuthorDetail() {
  const id = parseAuthorId(useParams().id);
  return id === null ? (
    <PageNotFound
      subject="Author"
      backTo="/authors"
      backLabel="Back to authors"
    />
  ) : (
    <AuthorPane id={id} />
  );
}
