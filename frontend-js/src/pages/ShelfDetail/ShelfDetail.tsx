import { useParams } from "react-router";
import { Unported } from "../../components/Unported/Unported";

export function ShelfDetail() {
  const { id } = useParams();
  return (
    <Unported
      title="Shelf"
      source="frontend/src/pages/shelf_detail/"
      params={{ id }}
    />
  );
}
