import { useSearchParams } from "react-router";
import { Unported } from "../../components/Unported/Unported";

export function Admin() {
  const [search] = useSearchParams();
  return (
    <Unported
      title="Administration"
      source="frontend/src/pages/admin/"
      params={{ section: search.get("section") }}
    />
  );
}
