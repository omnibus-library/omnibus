import { useSearchParams } from "react-router";
import { Unported } from "../../components/Unported/Unported";

export function Stats() {
  const [search] = useSearchParams();
  return (
    <Unported
      title="Stats"
      source="frontend/src/pages/stats/"
      params={{ user: search.get("user") }}
    />
  );
}
