import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { dirtyLabels } from "./dirty";
import { Breadcrumb, PageHeader } from "./EditHeader";
import { MetaFormGrid } from "./MetaFormGrid";
import { SaveBar } from "./SaveBar";
import { Sidebar } from "./Sidebar";
import "./BookEdit.css";

function EditForm({ book }: { book: EditableBook }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const form = useForm<MetaForm>({
    resolver: zodResolver(MetaFormSchema),
    defaultValues: book.form,
  });
  const dirty = dirtyLabels(book.form, form.watch());

  // The book's detail page, the lists and the resume row all read what an edit changes.
  const leave = () => {
    for (const queryKey of [
      ["book", book.uuid],
      ["books"],
      ["shelf-page"],
      ["shelves"],
      ["progress", "recent"],
    ]) {
      queryClient.invalidateQueries({ queryKey });
    }
    navigate(`/books/${book.uuid}`);
  };
  const save = useMutation({
    mutationFn: (values: MetaForm) =>
      saveOverrides(book.uuid, overridesFrom(book.form, values)),
    onSuccess: leave,
  });
  const revert = useMutation({
    mutationFn: () => revertOverrides(book.uuid),
    onSuccess: leave,
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
          dirty={dirty}
          sortBy={book.sortBy}
          filename={book.filename}
        />
        <Sidebar
          book={book}
          saving={save.isPending || revert.isPending}
          onRevert={() => revert.mutate()}
        />
      </div>
      <SaveBar
        uuid={book.uuid}
        dirty={dirty}
        saving={save.isPending}
        error={
          form.formState.errors.printPages?.message ??
          save.error?.message ??
          revert.error?.message
        }
        onSave={form.handleSubmit((values) => save.mutate(values))}
      />
    </div>
  );
}

function BookEditFor({ uuid }: { uuid: BookUuid }) {
  const book = useQuery(editableBookQuery(uuid));
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
      return book.data ? (
        <EditForm book={book.data} />
      ) : (
        <PageNotFound subject="Book" />
      );
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
