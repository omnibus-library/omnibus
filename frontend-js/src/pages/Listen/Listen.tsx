import { useParams, useSearchParams } from "react-router";
import { ButtonLink } from "../../components/Button/Button";
import { Unported } from "../../components/Unported/Unported";

export function Listen() {
  const { uuid } = useParams();
  const [search] = useSearchParams();
  return (
    <Unported
      title="Listen"
      source="frontend/src/pages/listen.rs"
      params={{ uuid, file_id: search.get("file_id") }}
    >
      <ButtonLink to={`/books/${uuid}`}>Back to the book</ButtonLink>
    </Unported>
  );
}
