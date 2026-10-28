import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { PASSWORD_MIN } from "../auth/users.ts";

/** Validates a JSON body, answering `{ error }` with the first problem like every other API error. */
export function json<T extends z.ZodType>(schema: T) {
  return zValidator("json", schema, (result, c) => {
    if (!result.success)
      return c.json({ error: result.error.issues[0]?.message ?? "Invalid request." }, 400);
  });
}

export const password = z
  .string()
  .min(PASSWORD_MIN, `Passwords need at least ${PASSWORD_MIN} characters.`)
  .max(1024);

export const username = z
  .string()
  .trim()
  .regex(/^[a-zA-Z0-9._-]{1,64}$/, "Usernames use letters, digits, dots, dashes and underscores.");
