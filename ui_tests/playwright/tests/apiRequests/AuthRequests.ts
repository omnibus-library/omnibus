import type { APIResponse } from "@playwright/test";
import type { Credentials } from "../data/users";
import { BaseRequests } from "./BaseRequests";

/** Sign-in, rate limited to 10 calls a minute per IP, and who is signed in. */
export class AuthRequests extends BaseRequests {
  /** Returns the context's user, `{ id, username, is_admin, … }`. */
  getMe(): Promise<APIResponse> {
    return this.get("/api/auth/me");
  }

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
