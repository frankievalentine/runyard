import type { MachineConfig } from "@runyard/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { api, call } from "../api.ts";
import { yardQuery } from "../lib/yard.ts";

/** Add, ignore and restore for tailnet devices that aren't Runyard machines. */
export function usePeerActions(nodeId: string) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const refresh = () => queryClient.invalidateQueries({ queryKey: yardQuery.queryKey });
  return {
    add: useMutation({
      mutationFn: async () =>
        (await call(api.peers[":nodeId"].add.$post({ param: { nodeId } }))) as MachineConfig,
      onSuccess: async (machine) => {
        await refresh();
        void navigate({ to: "/machines/$id", params: { id: machine.id } });
      },
    }),
    ignore: useMutation({
      mutationFn: () => call(api.peers[":nodeId"].ignore.$post({ param: { nodeId } })),
      onSuccess: async () => {
        await refresh();
        void navigate({ to: "/" });
      },
    }),
    restore: useMutation({
      mutationFn: () => call(api.peers[":nodeId"].ignore.$delete({ param: { nodeId } })),
      onSuccess: refresh,
    }),
  };
}
