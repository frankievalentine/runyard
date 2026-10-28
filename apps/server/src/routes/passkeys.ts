import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import { Hono } from "hono";
import { z } from "zod";
import { requestOrigin, requireUser, type AppEnv, type Listener } from "../auth/identity.ts";
import {
  deletePasskey,
  listPasskeys,
  login,
  loginOptions,
  register,
  registrationOptions,
  toPasskeyView,
  type Challenges,
} from "../auth/passkeys.ts";
import { sessionView, signIn } from "../auth/signin.ts";
import type { Db } from "../db/index.ts";
import { json } from "./validate.ts";

/** The library checks a credential's structure; this only requires the fields it reads first. */
function credential<T>() {
  return z.custom<T>(
    (v) =>
      typeof v === "object" &&
      v !== null &&
      typeof (v as { id?: unknown }).id === "string" &&
      typeof (v as { response?: unknown }).response === "object",
    "That isn't a passkey response.",
  );
}

export function passkeyRoutes({
  db,
  listener,
  challenges,
}: {
  db: Db;
  listener: Listener;
  challenges: Challenges;
}) {
  return new Hono<AppEnv>()
    .post("/login/options", async (c) =>
      c.json(await loginOptions(challenges, requestOrigin(c, listener))),
    )
    .post(
      "/login/verify",
      json(
        z.object({ challengeId: z.string(), response: credential<AuthenticationResponseJSON>() }),
      ),
      async (c) => {
        const body = c.req.valid("json");
        const user = await login(db, challenges, {
          challengeId: body.challengeId,
          response: body.response,
        });
        return c.json(sessionView(db, c, user, signIn(db, listener, c, user)));
      },
    )
    .use(requireUser())
    .get("/", (c) => c.json(listPasskeys(db, c.get("identity").user!.id).map(toPasskeyView)))
    .post("/register/options", async (c) =>
      c.json(
        await registrationOptions(
          db,
          challenges,
          c.get("identity").user!,
          requestOrigin(c, listener),
        ),
      ),
    )
    .post(
      "/register/verify",
      json(
        z.object({
          challengeId: z.string(),
          name: z.string().trim().min(1, "Name the passkey.").max(64),
          response: credential<RegistrationResponseJSON>(),
        }),
      ),
      async (c) => {
        const body = c.req.valid("json");
        const passkey = await register(db, challenges, c.get("identity").user!, {
          challengeId: body.challengeId,
          name: body.name,
          response: body.response,
        });
        return c.json(toPasskeyView(passkey), 201);
      },
    )
    .delete("/:id", (c) => {
      if (!deletePasskey(db, c.get("identity").user!.id, c.req.param("id"))) {
        return c.json({ error: "No such passkey." }, 404);
      }
      return c.json({ ok: true });
    });
}
