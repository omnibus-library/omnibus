import { z } from "zod";
import {
  DownloadClientKind,
  isHttpUrl,
  type RequestsSettingsStatus,
  type RequestsSettingsUpdate,
} from "../../api";

const address = z
  .string()
  .trim()
  .refine(isHttpUrl, "Enter an http:// or https:// address.");

/** What the form says about each download client: its name, how to reach it, and what its login and category are called. */
export type ClientInfo = {
  name: string;
  addressPlaceholder: string;
  /** SABnzbd has no login: its API key goes in the secret field. */
  hasUsername: boolean;
  secret: "password" | "API key";
  /** Transmission files a download under a label, the others under a category. */
  category: "category" | "label";
};

/** Stands in for the client until the saved settings are read, so no program is named that may not be the one. */
export const UNREAD_CLIENT: ClientInfo = {
  name: "Download client",
  addressPlaceholder: "http://…",
  hasUsername: true,
  secret: "password",
  category: "category",
};

export const CLIENTS: Record<DownloadClientKind, ClientInfo> = {
  qbittorrent: {
    name: "qBittorrent",
    addressPlaceholder: "http://qbittorrent:8080…",
    hasUsername: true,
    secret: "password",
    category: "category",
  },
  transmission: {
    name: "Transmission",
    addressPlaceholder: "http://transmission:9091…",
    hasUsername: true,
    secret: "password",
    category: "label",
  },
  sabnzbd: {
    name: "SABnzbd",
    addressPlaceholder: "http://sabnzbd:8080…",
    hasUsername: false,
    secret: "API key",
    category: "category",
  },
  nzbget: {
    name: "NZBGet",
    addressPlaceholder: "http://nzbget:6789…",
    hasUsername: true,
    secret: "password",
    category: "category",
  },
};

/** The connections form, field by field as the inputs name them, read into the update a Save sends; a blank secret keeps the stored one. */
export const RequestsSchema = z
  .object({
    prowlarr_url: address,
    prowlarr_api_key: z.string(),
    download_client_kind: DownloadClientKind,
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
  download_client_kind: "qbittorrent",
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
  download_client_kind: saved.download_client_kind,
  download_client_url: saved.download_client_url ?? "",
  download_client_username: saved.download_client_username ?? "",
  download_client_password: "",
  download_client_category: saved.download_client_category,
  download_client_path_prefix: saved.download_client_path_prefix ?? "",
  download_path_prefix: saved.download_path_prefix ?? "",
});
