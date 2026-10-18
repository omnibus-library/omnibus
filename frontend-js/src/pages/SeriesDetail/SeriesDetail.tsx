import { useParams } from "react-router";
import { Unported } from "../../components/Unported/Unported";

export function SeriesDetail() {
  const { id } = useParams();
  return (
    <Unported
      title="Series"
      source="frontend/src/pages/series.rs"
      params={{ id }}
    />
  );
}
