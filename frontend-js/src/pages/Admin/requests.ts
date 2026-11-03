import { z } from "zod";
import type { RequestsSettingsStatus, RequestsSettingsUpdate } from "../../api";

const isHttpUrl = (url: string) => {
  if (url === "") return true;
  try {
    const { protocol, hostname } = new URL(url);
    return (protocol === "http:" || protocol === "https:") && hostname !== "";
  } catch {
    return false;
  }
};

const address = z
  .string()
  .trim()
  .refine(isHttpUrl, "Enter an http:// or https:// address.");

/** The connections form, field by field as the inputs name them, read into the update a Save sends; a blank secret keeps the stored one. */
export const RequestsSchema = z
  .object({
    prowlarr_url: address,
    prowlarr_api_key: z.string(),
    download_client_url: address,
    download_client_username: z.string().trim(),
    download_client_password: z.string(),
    download_client_category: z.string().trim(),
    download_client_path_prefix: z.string().trim(),
    download_path_prefix: z.string().trim(),
  })
  .transform(
    ({
      prowlarr_api_key,
      download_client_password,
      ...fields
    }): RequestsSettingsUpdate => ({
      ...fields,
      download_client_kind: "qbittorrent",
      ...(prowlarr_api_key !== "" && { prowlarr_api_key }),
      ...(download_client_password !== "" && { download_client_password }),
    }),
  );

/** The connections form's fields as typed. */
export type RequestsDraft = z.input<typeof RequestsSchema>;

/** What the form holds before anything is saved. */
export const BLANK_REQUESTS_DRAFT: RequestsDraft = {
  prowlarr_url: "",
  prowlarr_api_key: "",
  download_client_url: "",
  download_client_username: "",
  download_client_password: "",
  download_client_category: "",
  download_client_path_prefix: "",
  download_path_prefix: "",
};

/** The form as the server's saved connections fill it; the secrets are never read back. */
export const requestsDraftOf = (
  saved: RequestsSettingsStatus,
): RequestsDraft => ({
  prowlarr_url: saved.prowlarr_url ?? "",
  prowlarr_api_key: "",
  download_client_url: saved.download_client_url ?? "",
  download_client_username: saved.download_client_username ?? "",
  download_client_password: "",
  download_client_category: saved.download_client_category,
  download_client_path_prefix: saved.download_client_path_prefix ?? "",
  download_path_prefix: saved.download_path_prefix ?? "",
});
