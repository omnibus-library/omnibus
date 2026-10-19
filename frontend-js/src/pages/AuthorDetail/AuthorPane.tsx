import { useQuery } from "@tanstack/react-query";
import { type AuthorId, authorQuery } from "../../api";
import { Loading } from "../../components/Loading/Loading";

/** Stand-in until the author page is ported. */
export function AuthorPane({ id }: { id: AuthorId; preview?: boolean }) {
  const author = useQuery(authorQuery(id));
  return author.data ? (
    <h2 className="au-name">{author.data.name}</h2>
  ) : (
    <Loading kind="section" label="Finding the author" />
  );
}
