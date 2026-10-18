import { useParams, useSearchParams } from "react-router";
import { ButtonLink } from "../../components/Button/Button";
import { Unported } from "../../components/Unported/Unported";

export function PdfReader() {
  const { uuid } = useParams();
  const [search] = useSearchParams();
  return (
    <Unported
      title="PDF reader"
      source="frontend/src/pages/pdf_reader/"
      params={{
        uuid,
        file_id: search.get("file_id"),
        page: search.get("page"),
      }}
    >
      <ButtonLink to={`/books/${uuid}`}>Back to the book</ButtonLink>
    </Unported>
  );
}
