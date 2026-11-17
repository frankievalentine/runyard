import { createFileRoute, redirect } from "@tanstack/react-router";
import { SettingsPage } from "../../components/settings/SettingsPage.tsx";
import { sessionQuery } from "../../lib/queries.ts";

/** Settings, scrolled to Connections; only admins see it. */
export const Route = createFileRoute("/_app/settings/connections")({
  beforeLoad: async ({ context }) => {
    const session = await context.queryClient.ensureQueryData(sessionQuery);
    if (session.user?.role !== "admin") throw redirect({ to: "/settings/account" });
  },
  component: () => <SettingsPage focus="connections" />,
});
