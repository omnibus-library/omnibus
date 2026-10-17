import type { APIRequestContext, APIResponse } from "@playwright/test";

/** Thin wrapper over an `APIRequestContext` that returns raw responses. */
export abstract class BaseRequests {
  constructor(protected readonly request: APIRequestContext) {}

  protected get(url: string): Promise<APIResponse> {
    return this.request.get(url);
  }

  protected post(url: string, data?: unknown): Promise<APIResponse> {
    return this.request.post(url, { data });
  }

  protected put(url: string, data?: unknown): Promise<APIResponse> {
    return this.request.put(url, { data });
  }

  protected delete(url: string): Promise<APIResponse> {
    return this.request.delete(url);
  }
}
