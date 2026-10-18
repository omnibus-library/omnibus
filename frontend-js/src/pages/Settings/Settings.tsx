import { useSearchParams } from "react-router";
import { Unported } from "../../components/Unported/Unported";

export function Settings() {
  const [search] = useSearchParams();
  return (
    <Unported
      title="Settings"
      source="frontend/src/pages/settings/"
      params={{ section: search.get("section") }}
    />
  );
}
