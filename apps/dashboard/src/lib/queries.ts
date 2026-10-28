import { queryOptions } from "@tanstack/react-query";
import { api, call } from "../api.ts";

export const healthQuery = queryOptions({
  queryKey: ["health"],
  queryFn: () => call(api.health.$get()),
  refetchInterval: 15_000,
});

export const sessionQuery = queryOptions({
  queryKey: ["session"],
  queryFn: () => call(api.session.$get()),
});

export type Session = Awaited<ReturnType<NonNullable<(typeof sessionQuery)["queryFn"]>>>;

export const usersQuery = queryOptions({
  queryKey: ["users"],
  queryFn: () => call(api.users.$get()),
});

export type UserView = Awaited<ReturnType<NonNullable<(typeof usersQuery)["queryFn"]>>>[number];

export const passkeysQuery = queryOptions({
  queryKey: ["passkeys"],
  queryFn: () => call(api.passkeys.$get()),
});

/** The control machine's setup checks (admins only). */
export const checksQuery = queryOptions({
  queryKey: ["setup-checks"],
  queryFn: () => call(api.setup.checks.$get()),
});
