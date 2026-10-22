import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type BookDetail,
  type Shelf,
  setShelfMember,
  undoBookMerge,
} from "../../api";
import { DeleteBookDialog } from "../../components/DeleteBookDialog/DeleteBookDialog";
import { MergeDialog } from "../../components/MergeDialog/MergeDialog";
import {
  type PickerList,
  ShelfPicker,
} from "../../components/ShelfPicker/ShelfPicker";
import { useToast } from "../../components/Toast/Toast";
import { useCurrentUser } from "../../session";
import { bookQuery, shelvesQuery, useLeaveBook } from "./queries";
import {
  automaticShelves,
  pickerTargets,
  withMemberSummary,
  withMembership,
} from "./shelves";

/** The dialogs the book page opens from its More menu and its tabs; the page owns which is open. */
export type BookDialog = "shelf" | "merge" | "delete";

/** The book's shelf facts, the picker's list of them, and the write that files it onto a hand-picked shelf or takes it off. */
export function useShelfMembership(book: BookDetail) {
  const client = useQueryClient();
  const viewer = useCurrentUser();
  const { queryKey } = shelvesQuery(book.uuid);
  const shelves = useQuery(shelvesQuery(book.uuid));
  const toggle = useMutation({
    mutationFn: ({ shelf, adding }: { shelf: Shelf; adding: boolean }) =>
      setShelfMember(shelf.id, book.uuid, adding),
    // A read begun before the write would answer with the old membership.
    onMutate: () => client.cancelQueries({ queryKey }),
    // The tile, the count and the ledge follow without waiting on a refetch.
    onSuccess: (_done, { shelf, adding }) =>
      client.setQueryData(
        queryKey,
        (facts) =>
          facts && {
            ...facts,
            manualIds: withMembership(facts.manualIds, shelf.id, adding),
            all: withMemberSummary(
              facts.all,
              shelf.id,
              book.uuid,
              book.hasCover,
              adding,
            ),
          },
      ),
    onSettled: () => {
      void client.invalidateQueries({ queryKey });
    },
  });
  const facts = shelves.data;
  const list: PickerList = facts
    ? {
        status: "ready",
        targets: pickerTargets(facts.all, viewer),
        checked: facts.manualIds,
        automatic: automaticShelves(facts),
      }
    : shelves.isError
      ? { status: "failed" }
      : { status: "loading" };
  return { shelves, facts, viewer, toggle, list };
}

/** The picker that files the book onto a hand-picked shelf or takes it off. */
export function ShelfDialog({
  book,
  onClose,
}: {
  book: BookDetail;
  onClose: () => void;
}) {
  const { facts, viewer, toggle, list } = useShelfMembership(book);
  return (
    <ShelfPicker
      list={list}
      viewer={viewer}
      busy={toggle.isPending ? toggle.variables.shelf.id : null}
      error={
        toggle.isError
          ? `Couldn’t update ${toggle.variables.shelf.name}: ${toggle.error.message}`
          : null
      }
      onPick={(id) => {
        const shelf = facts?.all.find((s) => s.id === id);
        if (shelf && facts)
          toggle.mutate({ shelf, adding: !facts.manualIds.includes(id) });
      }}
      onClose={onClose}
    />
  );
}

type BookDialogsProps = {
  book: BookDetail;
  dialog: BookDialog | null;
  onClose: () => void;
};

/** The open dialog, if any. Merge and delete leave the page refetched, or gone when the book is; a merge offers its undo as a toast. */
export function BookDialogs({ book, dialog, onClose }: BookDialogsProps) {
  const client = useQueryClient();
  const toast = useToast();
  const leave = useLeaveBook(book.uuid);
  const refresh = () =>
    client.invalidateQueries({ queryKey: bookQuery(book.uuid).queryKey });
  // Here, not in the merge dialog, which is gone by the time the toast's Undo is pressed.
  const undo = useMutation({
    mutationFn: undoBookMerge,
    onSuccess: () => {
      toast("Merge undone");
      return refresh();
    },
    onError: (error) => toast(error.message),
  });
  switch (dialog) {
    case null:
      return null;
    case "shelf":
      return <ShelfDialog book={book} onClose={onClose} />;
    case "merge":
      return (
        <MergeDialog
          target={book}
          onMerged={(logId) => {
            onClose();
            void refresh();
            toast("Books merged", {
              label: "Undo",
              onClick: () => undo.mutate(logId),
            });
          }}
          onClose={onClose}
        />
      );
    case "delete":
      return (
        <DeleteBookDialog
          uuid={book.uuid}
          title={book.title}
          onDeleted={(bookDeleted) => {
            onClose();
            if (!bookDeleted) return refresh();
            leave();
          }}
          onClose={onClose}
        />
      );
    default: {
      const _exhaustive: never = dialog;
      return _exhaustive;
    }
  }
}
