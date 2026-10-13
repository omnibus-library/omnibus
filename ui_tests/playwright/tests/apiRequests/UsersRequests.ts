import type { APIResponse } from "@playwright/test";
import type { NewUser } from "../data/users";
import { BaseRequests } from "./BaseRequests";

/** User administration; needs an admin's context. */
export class UsersRequests extends BaseRequests {
  postUser(user: NewUser): Promise<APIResponse> {
    return this.post("/api/admin/users", user);
  }

  deleteUser(id: number): Promise<APIResponse> {
    return this.delete(`/api/admin/users/${id}`);
  }
}
