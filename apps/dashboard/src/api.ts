import type { AppType } from "@runyard/server/app";
import { hc, parseResponse, type ClientResponse } from "hono/client";

export const api = hc<AppType>("/").api;

/** A failed API call, carrying the server's `{ error }` sentence as its message. */
export class ApiError extends Error {
  readonly status: number;
  /** The server's `code`, where it names the kind of failure. */
  readonly code: string | null;

  constructor(status: number, message: string, code: string | null = null) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Awaits a client call and returns its typed success body, or throws an `ApiError`. */
export async function call<T extends ClientResponse<unknown>>(
  request: T | Promise<T>,
): ReturnType<typeof parseResponse<T>> {
  const res = await request;
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string; code?: string } | null;
    throw new ApiError(
      res.status,
      body?.error ?? `The server answered ${res.status}.`,
      body?.code ?? null,
    );
  }
  return parseResponse(res);
}
