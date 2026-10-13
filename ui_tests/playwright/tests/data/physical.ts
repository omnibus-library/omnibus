/** A physical copy as `GET /api/physical/:uuid/copies` lists it. */
export type PhysicalCopy = {
  id: number;
  book_uuid: string;
  added_by_name?: string;
};
