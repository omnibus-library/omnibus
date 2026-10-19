import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate, useParams } from "react-router";
import {
  type BookUuid,
  type EditableBook,
  editableBookQuery,
  type MetaForm,
  MetaFormSchema,
  overridesFrom,
  parseBookUuid,
  revertOverrides,
  saveOverrides,
} from "../../api";
import { Loading } from "../../components/Loading/Loading";
import { PageError, PageNotFound } from "../../components/PageState/PageState";
import { PageTitle } from "../../components/PageTitle/PageTitle";
import { UnsavedDialog, useLeaveGuard } from "../../components/Unsaved/Unsaved";
import type { CoverProps } from "./CoverEditor";
import { dirtyLabels } from "./dirty";
import { Breadcrumb, PageHeader } from "./EditHeader";
import { MetaFormGrid } from "./MetaFormGrid";
import { SaveBar } from "./SaveBar";
import { Sidebar } from "./Sidebar";
import "../BookDetail/BookDetail.css";
import "./BookEdit.css";

function EditForm({ book }: { book: EditableBook }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const form = useForm<MetaForm>({
    resolver: zodResolver(MetaFormSchema),
    defaultValues: book.form,
  });
  // The book as the server last reported it, which a cover write moves; `book.form` stays the baseline.
  const [live, setLive] = useState(book);
  const [coverReplaced, setCoverReplaced] = useState(false);
  const dirty = dirtyLabels(book.form, form.watch());
  const { blocker, allowLeave } = useLeaveGuard(dirty.length > 0);

  // The book's detail page, the lists and the resume row all read what an edit changes.
  const written = () => {
    for (const queryKey of [
      ["book", book.uuid],
      ["books"],
      ["shelf-page"],
      ["shelves"],
      ["progress", "recent"],
    ]) {
      queryClient.invalidateQueries({ queryKey });
    }
  };
  // Passed per call: TanStack drops those once the page is gone, so a late answer doesn't navigate.
  const leave = () => {
    allowLeave();
    navigate(`/books/${book.uuid}`);
  };
  // A cover is written the moment it is picked, so Save has nothing to send for it.
  const onCoverApplied = (updated: EditableBook) => {
    setLive(updated);
    setCoverReplaced(true);
    // Exact, so the edit query holding the unsaved form isn't refetched out from under it.
    queryClient.invalidateQueries({
      queryKey: ["book", book.uuid],
      exact: true,
    });
    queryClient.invalidateQueries({ queryKey: ["books"] });
  };
  const cover = {
    book: live,
    target: { kind: "live", uuid: book.uuid, onApplied: onCoverApplied },
  } satisfies CoverProps;
  const save = useMutation({
    mutationFn: (values: MetaForm) =>
      saveOverrides(book.uuid, overridesFrom(book.form, values)),
    onSuccess: written,
  });
  const revert = useMutation({
    mutationFn: () => revertOverrides(book.uuid),
    onSuccess: written,
  });

  return (
    <div
      className="me-root"
      style={book.accent ? { "--accent": book.accent } : undefined}
    >
      <PageTitle page="Edit metadata" />
      <Breadcrumb
        uuid={book.uuid}
        displayTitle={book.displayTitle}
        author={book.primaryAuthor}
      />
      <PageHeader
        displayTitle={book.displayTitle}
        author={book.primaryAuthor?.name}
      />
      <div className="me-layout">
        <MetaFormGrid
          form={form}
          baseline={book.form}
          cover={cover}
          dirty={dirty}
          sortBy={book.sortBy}
          filename={book.filename}
        />
        <Sidebar
          book={live}
          cover={cover}
          saving={save.isPending || revert.isPending}
          onRevert={() => {
            save.reset();
            revert.mutate(undefined, { onSuccess: leave });
          }}
        />
      </div>
      <SaveBar
        mode={{ kind: "edit", uuid: book.uuid }}
        dirty={dirty}
        coverReplaced={coverReplaced}
        saving={save.isPending || revert.isPending}
        error={
          form.formState.errors.printPages?.message ??
          save.error?.message ??
          revert.error?.message
        }
        onSave={form.handleSubmit((values) => {
          revert.reset();
          save.mutate(values, { onSuccess: leave });
        })}
        onDiscard={allowLeave}
      />
      <UnsavedDialog blocker={blocker} />
    </div>
  );
}

function BookEditFor({ uuid }: { uuid: BookUuid }) {
  const book = useQuery(editableBookQuery(uuid));
  // A failed refetch keeps the form: the data it holds is what the user is editing.
  if (book.data) return <EditForm book={book.data} />;
  switch (book.status) {
    case "pending":
      return <Loading kind="page" label="Opening the record" />;
    case "error":
      return (
        <PageError
          message={book.error.message}
          backTo={`/books/${uuid}`}
          backLabel="Back to book"
        />
      );
    case "success":
      return <PageNotFound subject="Book" />;
    default: {
      const _exhaustive: never = book;
      return _exhaustive;
    }
  }
}

export function BookEdit() {
  const uuid = parseBookUuid(useParams().uuid);
  return uuid ? <BookEditFor uuid={uuid} /> : <PageNotFound subject="Book" />;
}
