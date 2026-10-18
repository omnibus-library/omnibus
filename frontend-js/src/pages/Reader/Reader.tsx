import { useParams } from "react-router";
import { ButtonLink } from "../../components/Button/Button";
import { Unported } from "../../components/Unported/Unported";

export function Reader() {
  const { uuid } = useParams();
  return (
    <Unported
      title="Reader"
      source="frontend/src/pages/reader/"
      params={{ uuid }}
    >
      <ButtonLink to={`/books/${uuid}`}>Back to the book</ButtonLink>
    </Unported>
  );
}
