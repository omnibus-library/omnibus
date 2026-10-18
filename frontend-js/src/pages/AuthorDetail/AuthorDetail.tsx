import { useParams } from "react-router";
import { Unported } from "../../components/Unported/Unported";

export function AuthorDetail() {
  const { id } = useParams();
  return (
    <Unported
      title="Author"
      source="frontend/src/pages/author.rs"
      params={{ id }}
    />
  );
}
