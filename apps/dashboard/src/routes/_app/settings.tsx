import { createFileRoute, Outlet } from "@tanstack/react-router";

/**
 * Settings: one page (components/settings/SettingsPage.tsx) at /settings/account, and at
 * /settings/connections and /settings/users for older links; GitHub and Forgejo have their own.
 */
export const Route = createFileRoute("/_app/settings")({
  component: Outlet,
});
