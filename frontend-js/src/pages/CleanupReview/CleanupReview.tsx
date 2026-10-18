import { useParams } from "react-router";
import { Unported } from "../../components/Unported/Unported";

export function CleanupReview() {
  const { kind } = useParams();
  return (
    <Unported
      title="Cleanup review"
      source="frontend/src/pages/cleanup_review.rs"
      params={{ kind }}
    />
  );
}
