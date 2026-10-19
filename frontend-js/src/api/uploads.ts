import type { z } from "zod";
import { ApiError } from "./core";
import {
  getPostInspectAudiobookUrl,
  getPostInspectEbookUrl,
  getPostUploadAudiobookUrl,
  getPostUploadEbookUrl,
} from "./generated/omnibus";
import {
  AudiobookInspection,
  type Identifier,
  UploadCommitResult,
  UploadInspection,
} from "./generated/schemas";
import { type MetaForm, overridesFrom } from "./metadata";

// The add books page's reads and writes: pick a file, have the server read it, then review the record.

export type UploadKind = "ebook" | "audiobook";

const EBOOK_EXTENSIONS = ["epub", "pdf"];
const AUDIOBOOK_EXTENSIONS = ["m4b", "m4a", "mp4", "mp3"];

/** The picker's `accept` list: every extension plus the MIME types, so a browser filters its dialog. */
export const UPLOAD_ACCEPT =
  ".epub,.pdf,.m4b,.m4a,.mp4,.mp3,application/epub+zip,application/pdf,audio/mp4,audio/mpeg";

const extensionOf = (name: string) =>
  name.includes(".") ? (name.split(".").pop() ?? "").toLowerCase() : "";

/** Which ingest a pick goes to, decided by the file extensions, or why it can't go at all. */
export function classifyPick(
  names: string[],
): { ok: true; kind: UploadKind } | { ok: false; reason: string } {
  let ebooks = 0;
  let audio = 0;
  for (const name of names) {
    const ext = extensionOf(name);
    if (EBOOK_EXTENSIONS.includes(ext)) ebooks += 1;
    else if (AUDIOBOOK_EXTENSIONS.includes(ext)) audio += 1;
    else {
      return {
        ok: false,
        reason: `${name} isn't a format Omnibus can add — pick an EPUB or PDF, an M4B/M4A/MP4 audiobook, or MP3 parts.`,
      };
    }
  }
  if (ebooks === 0 && audio === 0) {
    return { ok: false, reason: "Choose a file first." };
  }
  if (ebooks === 1 && audio === 0) return { ok: true, kind: "ebook" };
  if (ebooks === 0) return { ok: true, kind: "audiobook" };
  return {
    ok: false,
    reason:
      audio === 0
        ? "Add one EPUB at a time."
        : "Pick either an EPUB or an audiobook's files, not both.",
  };
}

/** What an upload that failed reads as: the server's own text, except where it can't have said anything. */
export function uploadFailureMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 413) {
      return "That file is larger than this server accepts.";
    }
    // A body-limit rejection mid-send drops the connection before any answer.
    if (error.status === 0) {
      return "The upload stopped before the server answered. The file may be larger than this server accepts.";
    }
  }
  return error instanceof Error ? error.message : String(error);
}

/** XHR rather than `fetch`, so the body's upload progress is observable. */
function sendMultipart<T>(
  url: string,
  form: FormData,
  schema: z.ZodType<T>,
  onProgress: (fraction: number) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onerror = () => reject(new ApiError(0, ""));
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new ApiError(xhr.status, xhr.responseText));
        return;
      }
      try {
        resolve(schema.parse(JSON.parse(xhr.responseText)));
      } catch (e) {
        reject(e);
      }
    };
    xhr.send(form);
  });
}

/** What the server read from a pick: the review form's starting point. Nothing here exists in the library yet. */
export type Inspected = {
  kind: UploadKind;
  /** What the drop zone shows for the pick. */
  label: string;
  files: File[];
  form: MetaForm;
  identifiers: Identifier[];
  /** The file's own cover as a `data:` URL, when it has one. */
  coverPreview: string | null;
};

const BLANK_FORM: MetaForm = {
  title: "",
  description: "",
  publisher: "",
  published: "",
  language: "",
  series: "",
  seriesIndex: "",
  isbn13: "",
  isbn10: "",
  printPages: "",
  authors: [],
  tags: [],
  genres: [],
};

/** The review form's starting values from an EPUB or PDF inspection. */
export function formFromEbookInspection(insp: UploadInspection): MetaForm {
  return {
    ...BLANK_FORM,
    title: insp.title ?? "",
    description: insp.description ?? "",
    publisher: insp.publisher ?? "",
    published: insp.published ?? "",
    language: insp.language ?? "",
    series: insp.series ?? "",
    seriesIndex: insp.series_index ?? "",
    isbn13: insp.isbn13 ?? "",
    authors: insp.creators ?? [],
    tags: insp.subjects ?? [],
  };
}

/** The review form's starting values from an audiobook's tags, which name no series, description or identifiers. */
export function formFromAudiobookInspection(
  insp: AudiobookInspection,
): MetaForm {
  return {
    ...BLANK_FORM,
    title: insp.title ?? "",
    authors: insp.creators ?? [],
  };
}

/** What the drop zone shows for a pick. */
export const pickLabel = (files: File[]) =>
  files.length === 1
    ? (files[0]?.name ?? "")
    : `${files.length} parts selected`;

function multipart(files: File[]) {
  const form = new FormData();
  for (const file of files) form.append("file", file);
  return form;
}

/** Has the server read the picked file(s); `onProgress` follows the body going up. */
export async function inspectUpload(
  kind: UploadKind,
  files: File[],
  onProgress: (fraction: number) => void,
): Promise<Inspected> {
  if (kind === "ebook") {
    const insp = await sendMultipart(
      getPostInspectEbookUrl(),
      multipart(files),
      UploadInspection,
      onProgress,
    );
    return {
      kind,
      label: pickLabel(files),
      files,
      form: formFromEbookInspection(insp),
      identifiers: insp.identifiers ?? [],
      coverPreview: insp.cover_preview ?? null,
    };
  }
  const insp = await sendMultipart(
    getPostInspectAudiobookUrl(),
    multipart(files),
    AudiobookInspection,
    onProgress,
  );
  return {
    kind,
    label: pickLabel(files),
    files,
    form: formFromAudiobookInspection(insp),
    identifiers: [],
    coverPreview: insp.cover_preview ?? null,
  };
}

/** Where a book's cover comes from at the add: the file's own, a picked image, or a provider's image URL. */
export type StagedSource =
  | { kind: "keep" }
  | { kind: "file"; file: File }
  | { kind: "url"; url: string };

/** Whether the review names what the commit cannot do without: a title and a first author file the book. */
export const hasIdentity = (values: MetaForm) =>
  Boolean(values.title.trim() && values.authors[0]?.trim());

/** The commit's text and cover fields, without the file(s), which go last. */
export function commitFields(
  baseline: MetaForm,
  values: MetaForm,
  cover: StagedSource,
): [string, string | File][] {
  const fields: [string, string | File][] = [
    ["title", values.title.trim()],
    ["author", values.authors[0]?.trim() ?? ""],
  ];
  const series = values.series.trim();
  const seriesIndex = values.seriesIndex.trim();
  if (series) fields.push(["series", series]);
  if (seriesIndex) fields.push(["series_index", seriesIndex]);
  const overrides = overridesFrom(baseline, values);
  if (Object.keys(overrides).length > 0) {
    fields.push(["overrides", JSON.stringify(overrides)]);
  }
  if (cover.kind === "file") fields.push(["cover", cover.file]);
  if (cover.kind === "url") fields.push(["cover_url", cover.url]);
  return fields;
}

/** Files the picked book with the reviewed record and cover in one request; answers with its uuid. */
export async function commitUpload(
  pick: Inspected,
  values: MetaForm,
  cover: StagedSource,
  onProgress: (fraction: number) => void,
): Promise<string> {
  const form = new FormData();
  for (const [name, value] of commitFields(pick.form, values, cover)) {
    form.append(name, value);
  }
  for (const file of pick.files) form.append("file", file);
  const url =
    pick.kind === "ebook"
      ? getPostUploadEbookUrl()
      : getPostUploadAudiobookUrl();
  return (await sendMultipart(url, form, UploadCommitResult, onProgress)).uuid;
}
