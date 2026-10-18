import { useParams } from "react-router";
import { Unported } from "../../components/Unported/Unported";

export function Search() {
  const { query } = useParams();
  return (
    <Unported
      title="Search"
      source="frontend/src/pages/search.rs"
      params={{ query }}
    />
  );
}
