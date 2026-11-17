import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { OnDemandList, PoolList } from "../../components/YardLists.tsx";
import { sessionQuery } from "../../lib/queries.ts";
import { useYard } from "../../lib/yard.ts";

export const Route = createFileRoute("/_app/pools/")({
  component: Pools,
});

/** Every pool, and boat.dev's on-demand runners. */
function Pools() {
  const view = useYard();
  const { data: session } = useSuspenseQuery(sessionQuery);
  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="font-ui text-[28px] leading-none font-extrabold [font-stretch:85%]">
          Pools
        </h1>
        <p className="mt-1.5 text-[13px] text-tt-ink-2">
          A pool turns labels, machines and repositories into runners.
        </p>
      </header>
      <PoolList view={view} admin={session.user?.role === "admin"} />
      <OnDemandList view={view} />
    </div>
  );
}
