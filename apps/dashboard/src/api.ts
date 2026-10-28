import type { AppType } from "@runyard/server/app";
import { hc, parseResponse, type ClientResponse } from "hono/client";

export const api = hc<AppType>("/").api;

/** A failed API call, carrying the server's `{ error }` sentence as its message. */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Awaits a client call and returns its typed success body, or throws an `ApiError`. */
export async function call<T extends ClientResponse<unknown>>(
  request: T | Promise<T>,
): ReturnType<typeof parseResponse<T>> {
  const res = await request;
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(res.status, body?.error ?? `The server answered ${res.status}.`);
  }
  return parseResponse(res);
}
