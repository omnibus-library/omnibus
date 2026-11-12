import type {
  NotificationConnectionInput,
  PublicUrlStatus,
} from "../data/notifications";
import { type ExpectMutationOptions, post } from "../utils/api";

/** The endpoints Administration › Notifications reads and writes. */
export const notificationUrls = {
  publicUrl: /\/api\/settings\/public-url(?:\?|$)/,
  connections: /\/api\/admin\/notifications\/connections(?:\?|$)/,
  connection: /\/api\/admin\/notifications\/connections\/\d+(?:\?|$)/,
  test: /\/api\/admin\/notifications\/test(?:\?|$)/,
};

/** The writes an admin makes from the Notifications section. */
export const notifications = {
  /** A save of `url`, or a refusal of it with `status`. */
  savePublicUrl: (
    url: PublicUrlStatus["url"],
    status = 200,
  ): ExpectMutationOptions => post(notificationUrls.publicUrl, { url }, status),

  create: (body: NotificationConnectionInput): ExpectMutationOptions =>
    post(notificationUrls.connections, body, 201),

  /** A save of a whole connection; `body` is checked exactly, so a secret it leaves out must not be sent. */
  update: (body: NotificationConnectionInput): ExpectMutationOptions => ({
    method: "PUT",
    url: notificationUrls.connection,
    expectedBody: body,
    expectedStatus: 200,
  }),

  delete: (): ExpectMutationOptions => ({
    method: "DELETE",
    url: notificationUrls.connection,
    expectedStatus: 204,
  }),

  /** A test send, which the provider (or the network) refused with `status`. */
  test: (status: number): ExpectMutationOptions =>
    post(notificationUrls.test, undefined, status),
};
