import { useParams } from "react-router";
import { Unported } from "../../components/Unported/Unported";

export function BookEdit() {
  const { uuid } = useParams();
  return (
    <Unported
      title="Edit metadata"
      source="frontend/src/pages/metadata_edit.rs"
      params={{ uuid }}
    />
  );
}
