/** A physical copy as `GET /api/physical/:uuid/copies` lists it. */
export type PhysicalCopy = {
  id: number;
  book_uuid: string;
  added_by_name?: string;
  note: string | null;
};

/** A copy a test filed, told apart from every other copy by its note. */
export type FiledCopy = { bookUuid: string; note: string };
