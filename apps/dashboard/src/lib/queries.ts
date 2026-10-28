import { queryOptions } from "@tanstack/react-query";
import { api } from "../api.ts";

export const healthQuery = queryOptions({
  queryKey: ["health"],
  queryFn: async () => {
    const res = await api.health.$get();
    if (!res.ok) throw new Error(`The server answered ${res.status}.`);
    return res.json();
  },
  refetchInterval: 15_000,
});
