import { createFileRoute } from "@tanstack/react-router";
import { SettingsPage } from "../../components/settings/SettingsPage.tsx";

export const Route = createFileRoute("/_app/settings/account")({
  component: () => <SettingsPage />,
});
