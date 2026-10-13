import type { APIResponse } from "@playwright/test";
import type { Credentials } from "../data/users";
import { BaseRequests } from "./BaseRequests";

/** Sign-in. Rate limited to 10 calls a minute per IP, so call it sparingly. */
export class AuthRequests extends BaseRequests {
  /** Sets the session cookie on this context. */
  postCookieLogin(credentials: Credentials): Promise<APIResponse> {
    return this.post("/api/auth/login", credentials);
  }

  /** Returns `{ token }` for the `Authorization: Bearer` header. */
  postBearerLogin(credentials: Credentials): Promise<APIResponse> {
    return this.post("/api/auth/login", {
      ...credentials,
      client_kind: "bearer",
    });
  }
}
