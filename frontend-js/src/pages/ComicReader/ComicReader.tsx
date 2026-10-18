import { useParams } from "react-router";
import { ButtonLink } from "../../components/Button/Button";
import { Unported } from "../../components/Unported/Unported";

export function ComicReader() {
  const { uuid } = useParams();
  return (
    <Unported
      title="Comic reader"
      source="frontend/src/pages/comic_reader.rs"
      params={{ uuid }}
    >
      <ButtonLink to={`/books/${uuid}`}>Back to the book</ButtonLink>
    </Unported>
  );
}
