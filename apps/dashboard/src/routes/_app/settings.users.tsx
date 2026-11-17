import { createFileRoute, redirect } from "@tanstack/react-router";
import { SettingsPage } from "../../components/settings/SettingsPage.tsx";
import { sessionQuery } from "../../lib/queries.ts";

/** Settings, scrolled to Users; only admins see it. */
export const Route = createFileRoute("/_app/settings/users")({
  beforeLoad: async ({ context }) => {
    const session = await context.queryClient.ensureQueryData(sessionQuery);
    if (session.user?.role !== "admin") throw redirect({ to: "/" });
  },
  component: () => <SettingsPage focus="users" />,
});
