import type { YardView } from "@runyard/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, call } from "../api.ts";
import { yardQuery } from "./yard.ts";

/** Check now: Runyard reads every machine and forge at once, and the page shows what it found. */
export function useCheckNow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => (await call(api.check.$post())) as YardView,
    onSuccess: (next) => queryClient.setQueryData(yardQuery.queryKey, next),
  });
}
