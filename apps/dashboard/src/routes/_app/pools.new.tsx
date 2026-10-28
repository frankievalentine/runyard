import { createFileRoute, redirect } from "@tanstack/react-router";
import { Icon } from "../../components/icons.tsx";
import { PoolForm } from "../../components/PoolForm.tsx";
import { PageHeader } from "../../components/ui.tsx";
import { sessionQuery } from "../../lib/queries.ts";

export const Route = createFileRoute("/_app/pools/new")({
  beforeLoad: async ({ context }) => {
    const session = await context.queryClient.ensureQueryData(sessionQuery);
    if (session.user?.role !== "admin") throw redirect({ to: "/" });
  },
  component: NewPool,
});

function NewPool() {
  return (
    <div>
      <PageHeader
        icon={<Icon name="plan" size={18} />}
        title="New pool"
        subtitle="Runners with the same labels on the machines you choose, serving the organizations or repositories you choose."
      />
      <div className="mt-8">
        <PoolForm />
      </div>
    </div>
  );
}
