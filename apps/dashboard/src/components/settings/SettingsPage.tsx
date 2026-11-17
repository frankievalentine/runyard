import { useSuspenseQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { sessionQuery } from "../../lib/queries.ts";
import { AccessTokens } from "../AccessTokens.tsx";
import { SetupSummary } from "../SetupChecklist.tsx";
import { PageHead } from "../tt.tsx";
import { AccountPanel } from "./AccountPanel.tsx";
import { BoatPanel, ConnectionsPanel, HostPanel } from "./ConnectionsPanels.tsx";
import { InstallPanel } from "./InstallPanel.tsx";
import { UsersPanel } from "./UsersPanel.tsx";

/**
 * Settings on one page, as in the Timetable design: the forges, this host, boat.dev, access tokens
 * and installing the app on the left; your account, users and Getting started on the right. On a
 * phone the two columns stack. Only admins see connections, the host, users and Getting started.
 * `focus` scrolls to a panel, for the older /settings/connections and /settings/users links; a
 * link's #panel does the same, as the Board's host notices do with #host.
 */
export function SettingsPage({ focus }: { focus?: "connections" | "users" }) {
  const { data: session } = useSuspenseQuery(sessionQuery);
  const admin = session.user?.role === "admin";
  useEffect(() => {
    const target = focus ?? window.location.hash.slice(1);
    if (target) document.getElementById(target)?.scrollIntoView({ block: "start" });
  }, [focus]);
  return (
    <div>
      <PageHead title="Settings" />
      <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-2 lg:gap-[18px]">
        <div className="flex min-w-0 flex-col gap-3 lg:gap-[18px]">
          {admin && (
            <>
              <ConnectionsPanel />
              <HostPanel />
              <BoatPanel />
            </>
          )}
          <AccessTokens admin={admin} />
          <InstallPanel />
        </div>
        <div className="flex min-w-0 flex-col gap-3 lg:gap-[18px]">
          <AccountPanel />
          {admin && (
            <>
              <UsersPanel />
              <SetupSummary />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
